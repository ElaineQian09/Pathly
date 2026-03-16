import { Server as HttpServer } from "node:http";
import { WebSocketServer } from "ws";
import { logger } from "../logger.js";
import {
  InterruptResult,
  NewsItem,
  PlaceCandidate,
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

type GeminiAdapterLike = {
  composePlayback(
    plan: TurnPlan,
    session: RunSession,
    places: PlaceCandidate[],
    news: NewsItem[]
  ): Promise<PlaybackSegment> | PlaybackSegment;
  composeInterruptResult(
    session: RunSession,
    intent: string,
    transcriptPreview: string
  ): Promise<InterruptResult> | InterruptResult;
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

const parseJson = (raw: string) => JSON.parse(raw) as { type: string; payload: Record<string, unknown> };

export const handleWsMessage = async (socket: SocketLike, deps: WsDependencies, raw: string) => {
  try {
    const message = parseJson(raw);
    const payload = message.payload ?? {};
    const requestedSessionId = String(payload.sessionId ?? "");
    const resumeToken = typeof payload.resumeToken === "string" ? payload.resumeToken : null;
    const session = deps.sessionService.get(requestedSessionId) ?? (resumeToken ? deps.sessionService.getByResumeToken(resumeToken) : undefined);

    if (!session) {
      socket.send(JSON.stringify({
        type: "error",
        payload: {
          code: "session_not_found",
          message: "Run session not found."
        }
      }));
      return;
    }

    const sessionId = session.sessionId;
    logger.info("ws.message.received", {
      type: message.type,
      sessionId
    });

    switch (message.type) {
      case "session.join": {
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
        const parsed = contextSnapshotSchema.safeParse(payload);
        if (!parsed.success) {
          throw new Error("Invalid context.snapshot payload");
        }
        session.latestSnapshot = parsed.data;
        deps.sessionService.save(session);
        const checkpoint = deps.checkpointService.createCheckpoint(session);
        const plan = deps.routerService.createPlan(session, parsed.data);
        if (plan) {
          deps.sessionService.save(session);
          const places = await deps.placeService.getCandidates(parsed.data, session.routeSelection);
          const news = await deps.newsService.getCandidates(session.preferences);
          const segment = await deps.geminiAdapter.composePlayback(plan, session, places, news);
          logger.info("ws.turn.generated", {
            sessionId,
            turnId: plan.turnId,
            speaker: plan.speaker,
            reason: plan.reason,
            buckets: plan.contentBuckets
          });
          socket.send(JSON.stringify({ type: "turn.plan", payload: plan }));
          socket.send(JSON.stringify({ type: "playback.segment", payload: segment }));
        }

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
          socket.send(JSON.stringify({
            type: "playback.filler",
            payload: {
              turnId: `filler_${crypto.randomUUID()}`,
              speaker: session.currentSpeaker,
              segmentType: "filler",
              audioUrl: "https://example.com/audio/filler_repeat.mp3",
              transcriptPreview: "Repeating the last point in a tighter version.",
              safeInterruptAfterMs: 0,
              estimatedPlaybackMs: 1800
            }
          }));
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
        socket.send(JSON.stringify({
          type: "interrupt.result",
          payload: await deps.geminiAdapter.composeInterruptResult(
            session,
            intent,
            intent === "preference_change"
              ? "Got it. I updated the run settings and the next turns will follow that immediately."
              : "I heard you. I will answer directly first, then bring the show back in cleanly."
          )
        }));
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
        logger.info("ws.interrupt.voice.chunk", {
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
        socket.send(JSON.stringify({
          type: "interrupt.result",
          payload: await deps.geminiAdapter.composeInterruptResult(
            session,
            "direct_answer",
            "I heard the interruption and I am switching to a short direct response before resuming the show."
          )
        }));
        session.voiceInterruptChunks = [];
        deps.sessionService.save(session);
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
        socket.send(JSON.stringify({
          type: "error",
          payload: {
            code: "unsupported_event",
            message: `Unsupported websocket event: ${message.type}`
          }
        }));
    }
  } catch (error) {
    logger.error("ws.message.error", {
      message: error instanceof Error ? error.message : "Invalid websocket message"
    });
    socket.send(JSON.stringify({
      type: "error",
      payload: {
        code: "invalid_message",
        message: error instanceof Error ? error.message : "Invalid websocket message"
      }
    }));
  }
};

export const attachLiveServer = (server: HttpServer, deps: WsDependencies) => {
  const wss = new WebSocketServer({ server });

  wss.on("connection", (socket, request) => {
    const pathname = request.url?.split("?")[0] ?? "";
    logger.info("ws.connection.open", {
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
      logger.info("ws.connection.closed", {
        path: pathname
      });
    });
    socket.on("message", (data) => {
      void handleWsMessage(socket, deps, data.toString());
    });
  });

  return wss;
};
