import { Server as HttpServer } from "node:http";
import { WebSocketServer } from "ws";
import { loadConfig } from "../config.js";
import { GeneratedAudioMessage } from "../audio/pcm.js";
import { logger } from "../logger.js";
import {
  InterruptResult,
  NewsItem,
  PlaceCandidate,
  PlaybackLifecycleEvent,
  PlaybackSegment,
  RunSession,
  TurnPlan,
  contextSnapshotSchema,
  sessionPreferencesSchema
} from "../models/types.js";
import { CheckpointService } from "../services/checkpoint-service.js";
import { NewsService } from "../services/news-service.js";
import { PlaceService } from "../services/place-service.js";
import { RouterService } from "../services/router-service.js";
import { SessionService } from "../services/session-service.js";
import { LiveTurnCoordinator } from "../services/live-turn-coordinator.js";

type GeminiAdapterLike = {
  streamPlayback(
    plan: TurnPlan,
    session: RunSession,
    places: PlaceCandidate[],
    news: NewsItem[],
    callbacks: {
      onTranscript?: (transcript: string) => void;
      onChunk: (audioBase64: string, isFinalChunk: boolean) => void;
      onComplete?: (transcript: string) => void;
    },
    signal?: AbortSignal
  ): Promise<void> | void;
  streamInterruptResult(
    metadata: InterruptResult,
    session: RunSession,
    intent: string,
    transcriptPreview: string,
    callbacks: {
      onTranscript?: (transcript: string) => void;
      onChunk: (audioBase64: string, isFinalChunk: boolean) => void;
      onComplete?: (transcript: string) => void;
    },
    signal?: AbortSignal
  ): Promise<void> | void;
  composePlayback(
    plan: TurnPlan,
    session: RunSession,
    places: PlaceCandidate[],
    news: NewsItem[]
  ): Promise<GeneratedAudioMessage<PlaybackSegment>> | GeneratedAudioMessage<PlaybackSegment>;
  composeInterruptResult(
    session: RunSession,
    intent: string,
    transcriptPreview: string
  ): Promise<GeneratedAudioMessage<InterruptResult>> | GeneratedAudioMessage<InterruptResult>;
};

type WsDependencies = {
  sessionService: SessionService;
  routerService: RouterService;
  placeService: PlaceService;
  newsService: NewsService;
  checkpointService: CheckpointService;
  geminiAdapter: GeminiAdapterLike;
};

type SocketLike = {
  send(payload: string): void;
};

const coordinatorBySessionService = new WeakMap<SessionService, LiveTurnCoordinator>();

const getCoordinator = (deps: WsDependencies) => {
  let coordinator = coordinatorBySessionService.get(deps.sessionService);
  if (!coordinator) {
    const config = loadConfig();
    coordinator = new LiveTurnCoordinator(
      deps.sessionService,
      deps.routerService,
      deps.placeService,
      deps.newsService,
      deps.geminiAdapter,
      config.scheduler
    );
    coordinatorBySessionService.set(deps.sessionService, coordinator);
  }
  return coordinator;
};

const parseJson = (raw: string) => JSON.parse(raw) as { type: string; payload: Record<string, unknown> };

const sendError = (
  socket: SocketLike,
  code: string,
  message: string,
  options: { retryable?: boolean; source?: string } = {}
) => {
  socket.send(JSON.stringify({
    type: "error",
    payload: {
      code,
      message,
      retryable: options.retryable ?? false,
      source: options.source ?? "ws",
      timestamp: new Date().toISOString()
    }
  }));
};

export const handleWsMessage = async (socket: SocketLike, deps: WsDependencies, raw: string) => {
  let stage = "message.parse";
  let messageType = "unknown";
  let sessionIdForLog: string | null = null;
  const coordinator = getCoordinator(deps);

  try {
    const message = parseJson(raw);
    messageType = message.type;
    stage = "message.session_lookup";
    const payload = message.payload ?? {};
    const requestedSessionId = String(payload.sessionId ?? "");
    const resumeToken = typeof payload.resumeToken === "string" ? payload.resumeToken : null;
    const session = deps.sessionService.get(requestedSessionId) ?? (resumeToken ? deps.sessionService.getByResumeToken(resumeToken) : undefined);

    if (!session) {
      sendError(socket, "session_not_found", "Run session not found.", {
        retryable: false,
        source: "ws"
      });
      return;
    }

    const sessionId = session.sessionId;
    sessionIdForLog = sessionId;
    stage = `message.dispatch.${message.type}`;
    logger.debug("ws.message.received", {
      type: message.type,
      sessionId
    });

    switch (message.type) {
      case "session.join": {
        coordinator.attachSocket(sessionId, socket);
        if (resumeToken && session.status === "reconnecting") {
          session.reconnectIssued = false;
          deps.sessionService.save(session);
        }
        deps.sessionService.setStatus(sessionId, "active");
        logger.info("ws.session.ready", {
          sessionId,
          openingSpeaker: session.openingSpeaker
        });
        socket.send(JSON.stringify({
          type: "session.ready",
          payload: {
            sessionId,
            status: "active",
            openingSpeaker: session.openingSpeaker
          }
        }));
        break;
      }
      case "context.snapshot": {
        stage = "context.snapshot.validate";
        const parsed = contextSnapshotSchema.safeParse(payload);
        if (!parsed.success) {
          throw new Error("Invalid context.snapshot payload");
        }
        logger.debug("ws.context.snapshot.received", {
          sessionId,
          elapsedSeconds: parsed.data.motion.elapsedSeconds,
          offRoute: parsed.data.nav.offRoute,
          approachingManeuver: parsed.data.nav.approachingManeuver,
          quietModeEnabled: session.preferences.quietModeEnabled,
          quietModeUntil: session.preferences.quietModeUntil
        });
        const previousSnapshot = session.latestSnapshot;
        stage = "context.snapshot.create_checkpoint";
        session.latestSnapshot = parsed.data;
        deps.sessionService.save(session);
        const checkpoint = deps.checkpointService.createCheckpoint(session);
        logger.debug("ws.checkpoint.created", {
          sessionId,
          checkpointCount: session.checkpoints.length,
          resumeToken: checkpoint.resumeToken ?? `resume_${sessionId}`
        });
        stage = "context.snapshot.schedule_turn";
        await coordinator.handleSnapshot(session, parsed.data, previousSnapshot);

        stage = "context.snapshot.reconnect_check";
        if (!session.reconnectIssued && parsed.data.motion.elapsedSeconds >= 1800) {
          session.reconnectIssued = true;
          deps.sessionService.setStatus(sessionId, "reconnecting");
          deps.sessionService.save(session);
          logger.warn("ws.session.reconnect_required", {
            sessionId,
            resumeToken: checkpoint.resumeToken ?? `resume_${sessionId}`
          });
          socket.send(JSON.stringify({
            type: "session.reconnect_required",
            payload: {
              sessionId,
              status: "reconnecting",
              resumeToken: checkpoint.resumeToken ?? `resume_${sessionId}`,
              reason: "live_session_rollover"
            }
          }));
        }
        stage = "done";
        break;
      }
      case "quick_action": {
        deps.routerService.applyQuickAction(session, String(payload.action ?? ""));
        deps.sessionService.save(session);
        logger.info("ws.quick_action.applied", {
          sessionId,
          action: String(payload.action ?? "")
        });
        if (payload.action === "repeat" && session.lastTurnAt) {
          await coordinator.handleInterrupt(
            session,
            "repeat_or_clarify",
            "Repeat the last point more clearly and keep it aligned with the route context right now.",
            session.currentSpeaker
          );
        }
        break;
      }
      case "interrupt.text": {
        const text = String(payload.text ?? "");
        if (/less news/i.test(text)) {
          session.quickActionBias.local_context = (session.quickActionBias.local_context ?? 0) + 2;
          session.quickActionBias.news = 0;
        }
        if (/quiet/i.test(text)) {
          session.preferences.quietModeEnabled = true;
          session.preferences.quietModeUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        }
        const intent = /less|more|quiet|talk/i.test(text) ? "preference_change" : "question";
        deps.sessionService.save(session);
        logger.info("ws.interrupt.text", {
          sessionId,
          intent
        });
        await coordinator.handleTextInterrupt(session, text);
        break;
      }
      case "interrupt.voice.start": {
        session.voiceInterruptChunks = [];
        session.interruptedPlaybackTurnId = session.lastTurnAt;
        deps.sessionService.save(session);
        logger.info("ws.interrupt.voice.start", {
          sessionId
        });
        break;
      }
      case "interrupt.voice.chunk": {
        session.voiceInterruptChunks.push(String(payload.audioBase64 ?? ""));
        deps.sessionService.save(session);
        logger.debug("ws.interrupt.voice.chunk", {
          sessionId,
          chunkCount: session.voiceInterruptChunks.length
        });
        break;
      }
      case "interrupt.voice.end": {
        logger.info("ws.interrupt.voice.end", {
          sessionId,
          chunkCount: session.voiceInterruptChunks.length
        });
        await coordinator.handleInterrupt(
          session,
          "direct_question",
          "I heard the interruption and I am switching to a short direct response before resuming the show."
        );
        session.voiceInterruptChunks = [];
        deps.sessionService.save(session);
        break;
      }
      case "playback.started": {
        coordinator.markPlaybackStarted(payload as PlaybackLifecycleEvent);
        break;
      }
      case "playback.completed": {
        await coordinator.markPlaybackCompleted(payload as PlaybackLifecycleEvent);
        break;
      }
      case "session.pause": {
        deps.sessionService.setStatus(sessionId, "paused");
        logger.info("ws.session.paused", {
          sessionId
        });
        break;
      }
      case "session.resume": {
        deps.sessionService.setStatus(sessionId, "active");
        logger.info("ws.session.resumed", {
          sessionId
        });
        break;
      }
      case "session.end": {
        deps.sessionService.setStatus(sessionId, "ended");
        logger.info("ws.session.ended", {
          sessionId
        });
        break;
      }
      case "session.preferences.update": {
        const parsed = sessionPreferencesSchema.safeParse(payload.preferences);
        if (!parsed.success) {
          throw new Error("Invalid session.preferences.update payload");
        }
        deps.sessionService.updatePreferences(sessionId, parsed.data);
        const updatedSession = deps.sessionService.get(sessionId);
        logger.info("ws.session.preferences.updated", {
          sessionId,
          talkDensity: parsed.data.talkDensity,
          quietModeEnabled: parsed.data.quietModeEnabled
        });
        socket.send(JSON.stringify({
          type: "session.preferences.updated",
          payload: {
            sessionId,
            preferences: updatedSession?.preferences ?? parsed.data
          }
        }));
        break;
      }
      default:
        logger.warn("ws.message.unsupported", {
          sessionId,
          type: message.type
        });
      sendError(socket, "unsupported_event", `Unsupported websocket event: ${message.type}`, {
        retryable: false,
        source: "ws"
      });
    }
  } catch (error) {
    logger.error("ws.message.error", {
      type: messageType,
      sessionId: sessionIdForLog,
      stage,
      message: error instanceof Error ? error.message : "Invalid websocket message"
    });
    sendError(
      socket,
      "invalid_message",
      error instanceof Error ? error.message : "Invalid websocket message",
      {
        retryable: false,
        source: "ws"
      }
    );
  }
};

export const attachLiveServer = (server: HttpServer, deps: WsDependencies) => {
  const wss = new WebSocketServer({ server });

  wss.on("connection", (socket, request) => {
    const pathname = request.url?.split("?")[0] ?? "";
    logger.debug("ws.connection.open", {
      path: pathname
    });
    if (!pathname.startsWith("/v1/live")) {
      logger.warn("ws.connection.rejected", {
        path: pathname
      });
      socket.close();
      return;
    }
    socket.on("close", () => {
      logger.debug("ws.connection.closed", {
        path: pathname
      });
    });
    socket.on("message", (data) => {
      void handleWsMessage(socket, deps, data.toString());
    });
  });

  return wss;
};
