import { randomUUID } from "node:crypto";
import { Server as HttpServer } from "node:http";
import { WebSocketServer } from "ws";
import { GeneratedAudioMessage, PATHLY_AUDIO_FORMAT, createGeneratedAudioMessage } from "../audio/pcm.js";
import type { TurnStreamCallbacks, TurnStreamChunk, TurnStreamCompletion, TurnStreamHandle } from "../adapters/live-turn-stream.js";
import { logger } from "../logger.js";
import {
  NewsItem,
  PlaceCandidate,
  PlaybackAudioChunk,
  PlaybackFiller,
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
import { SchedulerService } from "../services/scheduler-service.js";
import { SessionService } from "../services/session-service.js";

type GeminiAdapterLike = {
  streamPlayback(
    plan: TurnPlan,
    session: RunSession,
    places: PlaceCandidate[],
    news: NewsItem[],
    callbacks: TurnStreamCallbacks<PlaybackSegment>
  ): TurnStreamHandle;
};

type WsDependencies = {
  sessionService: SessionService;
  routerService: RouterService;
  schedulerService: SchedulerService;
  placeService: PlaceService;
  newsService: NewsService;
  checkpointService: CheckpointService;
  geminiAdapter: GeminiAdapterLike;
};

type SocketLike = {
  send(payload: string): void;
};

type RuntimeTurnState = {
  handle: TurnStreamHandle;
  metadata: PlaybackSegment | null;
  bufferedChunks: TurnStreamChunk[];
  emittedSegment: boolean;
  flushedBufferedCount: number;
  droppedChunks: number;
  places: PlaceCandidate[];
  news: NewsItem[];
  completed: boolean;
};

type SessionRuntime = {
  socket: SocketLike;
  turns: Map<string, RuntimeTurnState>;
};

const runtimes = new Map<string, SessionRuntime>();

const parseJson = (raw: string) => JSON.parse(raw) as { type: string; payload: Record<string, unknown> };

const getRuntime = (sessionId: string, socket: SocketLike): SessionRuntime => {
  const existing = runtimes.get(sessionId);
  if (existing) {
    existing.socket = socket;
    return existing;
  }

  const created: SessionRuntime = {
    socket,
    turns: new Map()
  };
  runtimes.set(sessionId, created);
  return created;
};

const turnById = (session: RunSession, turnId: string) =>
  session.turns.find((turn) => turn.plan.turnId === turnId);

const activeTurn = (session: RunSession) =>
  session.scheduler.slots.activeTurnId ? turnById(session, session.scheduler.slots.activeTurnId) : undefined;

const emit = (socket: SocketLike, type: string, payload: Record<string, unknown>) => {
  socket.send(JSON.stringify({ type, payload }));
};

const sendError = (
  socket: SocketLike,
  code: string,
  reason: string,
  retryable = false,
  source: "provider" | "router" | "ws" | "player" = "ws"
) => {
  emit(socket, "error", {
    code,
    reason,
    retryable,
    source
  });
};

const buildChunkPayload = (plan: TurnPlan, chunk: TurnStreamChunk): PlaybackAudioChunk => ({
  turnId: plan.turnId,
  speaker: plan.speaker,
  segmentType: "main_turn",
  turnType: plan.turnType,
  priority: plan.priority,
  supersedesTurnId: plan.supersedesTurnId,
  recoveryOfTurnId: plan.recoveryOfTurnId,
  timestamp: new Date().toISOString(),
  chunkIndex: chunk.chunkIndex,
  audioBase64: chunk.audioBase64,
  isFinalChunk: chunk.isFinalChunk
});

const sendChunk = (runtime: SessionRuntime, payload: PlaybackAudioChunk) => {
  logger.info("ws.playback.audio.chunk.sent", {
    turnId: payload.turnId,
    chunkIndex: payload.chunkIndex,
    isFinalChunk: payload.isFinalChunk,
    priority: payload.priority,
    turnType: payload.turnType,
    chunkByteLength: Buffer.byteLength(payload.audioBase64, "base64")
  });
  emit(runtime.socket, "playback.audio.chunk", payload);
};

const emitSegment = (runtime: SessionRuntime, plan: TurnPlan, metadata: PlaybackSegment) => {
  emit(runtime.socket, "turn.plan", plan);
  emit(runtime.socket, "playback.segment", metadata);
};

const emitSupersede = (runtime: SessionRuntime, supersededTurnId: string, supersedingTurnId: string) => {
  emit(runtime.socket, "turn.superseded", {
    turnId: supersededTurnId,
    supersededByTurnId: supersedingTurnId,
    timestamp: new Date().toISOString()
  });
  emit(runtime.socket, "playback.abandoned", {
    turnId: supersededTurnId,
    supersededByTurnId: supersedingTurnId,
    timestamp: new Date().toISOString()
  });
};

const emitRecoveryCreated = (runtime: SessionRuntime, recoveryTurnId: string, recoveryOfTurnId: string) => {
  emit(runtime.socket, "turn.recovery.created", {
    turnId: recoveryTurnId,
    recoveryOfTurnId,
    timestamp: new Date().toISOString()
  });
};

const cancelTurnRuntime = (runtime: SessionRuntime, turnId: string) => {
  const turnRuntime = runtime.turns.get(turnId);
  if (!turnRuntime) {
    return;
  }
  turnRuntime.handle.cancel();
};

const activateBufferedTurnIfReady = (
  session: RunSession,
  runtime: SessionRuntime,
  deps: WsDependencies,
  turnId: string
) => {
  const turnRuntime = runtime.turns.get(turnId);
  const turn = turnById(session, turnId);
  if (!turnRuntime || !turn || !turnRuntime.metadata) {
    return;
  }
  if (!turnRuntime.emittedSegment) {
    emitSegment(runtime, turn.plan, turnRuntime.metadata);
    turnRuntime.emittedSegment = true;
  }
  for (const chunk of turnRuntime.bufferedChunks.slice(turnRuntime.flushedBufferedCount)) {
    sendChunk(runtime, buildChunkPayload(turn.plan, chunk));
    deps.schedulerService.recordEmittedChunk(session, turnId);
    turnRuntime.flushedBufferedCount += 1;
  }
};

const maybeActivateNext = (
  session: RunSession,
  runtime: SessionRuntime,
  deps: WsDependencies
) => {
  if (session.scheduler.slots.activeTurnId) {
    return;
  }
  const nextTurnId = deps.schedulerService.activateNextTurn(session);
  if (!nextTurnId) {
    return;
  }
  activateBufferedTurnIfReady(session, runtime, deps, nextTurnId);
};

const finalizeTurn = (
  session: RunSession,
  runtime: SessionRuntime,
  deps: WsDependencies,
  turnId: string,
  summary: TurnStreamCompletion
) => {
  deps.schedulerService.finalizeTurn(session, turnId, summary);
  const turn = turnById(session, turnId);
  if (!turn) {
    return;
  }

  if (session.scheduler.slots.activeTurnId === turnId) {
    session.scheduler.slots.activeTurnId = null;
  }

  if (turn.plan.priority !== "P2") {
    const recoveryTurnId = deps.schedulerService.maybeCreateRecovery(session, turnId);
    if (recoveryTurnId) {
      const recoveryTurn = turnById(session, recoveryTurnId);
      if (recoveryTurn) {
        emitRecoveryCreated(runtime, recoveryTurnId, recoveryTurn.plan.recoveryOfTurnId ?? "");
        ensureTurnStreaming(session, runtime, deps, recoveryTurnId);
      }
    }
  }

  maybeActivateNext(session, runtime, deps);
};

const ensureTurnStreaming = async (
  session: RunSession,
  runtime: SessionRuntime,
  deps: WsDependencies,
  turnId: string
) => {
  if (runtime.turns.has(turnId)) {
    activateBufferedTurnIfReady(session, runtime, deps, turnId);
    return;
  }

  const turn = turnById(session, turnId);
  const snapshot = session.latestSnapshot ?? session.previousSnapshot;
  if (!turn || !snapshot) {
    return;
  }

  const placesStartedAt = Date.now();
  logger.info("ws.places.fetch.start", {
    sessionId: session.sessionId,
    turnId,
    routeId: session.routeSelection.selectedRouteId
  });
  const places = await deps.placeService.getCandidates(snapshot, session.routeSelection);
  logger.info("ws.places.fetch.done", {
    sessionId: session.sessionId,
    turnId,
    placeCount: places.length,
    durationMs: Date.now() - placesStartedAt
  });

  const newsStartedAt = Date.now();
  logger.info("ws.news.fetch.start", {
    sessionId: session.sessionId,
    turnId,
    categories: session.preferences.newsCategories
  });
  const news = await deps.newsService.getCandidates(session.preferences);
  logger.info("ws.news.fetch.done", {
    sessionId: session.sessionId,
    turnId,
    newsCount: news.length,
    durationMs: Date.now() - newsStartedAt
  });

  const playbackStartedAt = Date.now();
  logger.info("ws.gemini.playback.start", {
    sessionId: session.sessionId,
    turnId,
    turnType: turn.plan.turnType,
    priority: turn.plan.priority,
    triggerType: turn.plan.triggerType
  });

  const callbacks: TurnStreamCallbacks<PlaybackSegment> = {
    onSegmentReady(metadata) {
      deps.schedulerService.markStreamReady(session, turnId, metadata.transcriptPreview);
      const turnRuntime = runtime.turns.get(turnId);
      if (!turnRuntime) {
        return;
      }
      turnRuntime.metadata = metadata;
      if (session.scheduler.slots.activeTurnId === turnId) {
        emitSegment(runtime, turn.plan, metadata);
        turnRuntime.emittedSegment = true;
        logger.info("ws.turn.emit.start", {
          sessionId: session.sessionId,
          turnId,
          priority: turn.plan.priority,
          turnType: turn.plan.turnType
        });
      }
    },
    onChunk(chunk) {
      const currentTurn = turnById(session, turnId);
      const turnRuntime = runtime.turns.get(turnId);
      if (!currentTurn || !turnRuntime) {
        return;
      }

      if (currentTurn.status === "superseded" || currentTurn.status === "abandoned") {
        deps.schedulerService.recordDroppedChunk(session, turnId);
        turnRuntime.droppedChunks += 1;
        return;
      }

      if (session.scheduler.slots.activeTurnId === turnId && turnRuntime.emittedSegment) {
        sendChunk(runtime, buildChunkPayload(currentTurn.plan, chunk));
        deps.schedulerService.recordEmittedChunk(session, turnId);
        return;
      }

      turnRuntime.bufferedChunks.push(chunk);
      deps.schedulerService.recordBufferedChunk(session, turnId);
    },
    onComplete(summary) {
      logger.info("ws.gemini.playback.done", {
        sessionId: session.sessionId,
        turnId,
        durationMs: Date.now() - playbackStartedAt,
        chunkCount: summary.chunkCount,
        transcriptLength: summary.transcriptPreview.length
      });
      finalizeTurn(session, runtime, deps, turnId, summary);
      deps.sessionService.save(session);
    },
    onError(error) {
      logger.warn("ws.gemini.playback.failed", {
        sessionId: session.sessionId,
        turnId,
        message: error.message
      });
      sendError(runtime.socket, "live_playback_failed", error.message, true, "provider");
    }
  };

  const runtimeTurn: RuntimeTurnState = {
    handle: {
      cancel() {},
      completed: Promise.resolve({
        transcriptPreview: "",
        estimatedPlaybackMs: 0,
        chunkCount: 0
      })
    },
    metadata: null,
    bufferedChunks: [],
    emittedSegment: false,
    flushedBufferedCount: 0,
    droppedChunks: 0,
    places,
    news,
    completed: false
  };
  runtime.turns.set(turnId, runtimeTurn);

  const handle = deps.geminiAdapter.streamPlayback(turn.plan, session, places, news, callbacks);
  runtimeTurn.handle = handle;

  void handle.completed.catch(() => {
    // Error path is reported via callbacks.onError.
  });
};

const applyMutation = async (
  session: RunSession,
  runtime: SessionRuntime,
  deps: WsDependencies,
  mutation: ReturnType<WsDependencies["schedulerService"]["handleSnapshot"]> | ReturnType<WsDependencies["schedulerService"]["handleUserInterrupt"]>
) => {
  if (mutation.supersededTurnId && mutation.activatedTurnId) {
    emitSupersede(runtime, mutation.supersededTurnId, mutation.activatedTurnId);
    cancelTurnRuntime(runtime, mutation.supersededTurnId);
  }

  for (const turnId of mutation.createdTurnIds) {
    await ensureTurnStreaming(session, runtime, deps, turnId);
  }

  if (mutation.activatedTurnId) {
    activateBufferedTurnIfReady(session, runtime, deps, mutation.activatedTurnId);
  }

  deps.sessionService.save(session);
};

export const handleWsMessage = async (socket: SocketLike, deps: WsDependencies, raw: string) => {
  let stage = "message.parse";
  let messageType = "unknown";
  let sessionIdForLog: string | null = null;

  try {
    const message = parseJson(raw);
    messageType = message.type;
    stage = "message.session_lookup";
    const payload = message.payload ?? {};
    const requestedSessionId = String(payload.sessionId ?? "");
    const resumeToken = typeof payload.resumeToken === "string" ? payload.resumeToken : null;
    const session = deps.sessionService.get(requestedSessionId) ?? (resumeToken ? deps.sessionService.getByResumeToken(resumeToken) : undefined);

    if (!session) {
      sendError(socket, "session_not_found", "Run session not found.", false, "ws");
      return;
    }

    const sessionId = session.sessionId;
    sessionIdForLog = sessionId;
    const runtime = getRuntime(sessionId, socket);
    stage = `message.dispatch.${message.type}`;
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
        emit(socket, "session.ready", {
          sessionId,
          status: "active",
          openingSpeaker: session.openingSpeaker
        });
        break;
      }
      case "context.snapshot": {
        const parsed = contextSnapshotSchema.safeParse(payload);
        if (!parsed.success) {
          throw new Error("Invalid context.snapshot payload");
        }
        logger.info("ws.context.snapshot.received", {
          sessionId,
          elapsedSeconds: parsed.data.motion.elapsedSeconds,
          offRoute: parsed.data.nav.offRoute,
          approachingManeuver: parsed.data.nav.approachingManeuver
        });

        const checkpoint = deps.checkpointService.createCheckpoint(session);
        logger.info("ws.checkpoint.created", {
          sessionId,
          checkpointCount: session.checkpoints.length,
          resumeToken: checkpoint.resumeToken ?? `resume_${sessionId}`
        });

        const mutation = deps.schedulerService.handleSnapshot(session, parsed.data);
        await applyMutation(session, runtime, deps, mutation);

        if (!session.reconnectIssued && parsed.data.motion.elapsedSeconds >= 1800) {
          session.reconnectIssued = true;
          deps.sessionService.setStatus(sessionId, "reconnecting");
          deps.sessionService.save(session);
          emit(socket, "session.reconnect_required", {
            sessionId,
            status: "reconnecting",
            resumeToken: checkpoint.resumeToken ?? `resume_${sessionId}`,
            reason: "live_session_rollover"
          });
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
          const filler: GeneratedAudioMessage<PlaybackFiller> = createGeneratedAudioMessage({
            turnId: `filler_${randomUUID()}`,
            speaker: session.currentSpeaker,
            segmentType: "filler",
            turnType: "filler",
            priority: "P2",
            supersedesTurnId: null,
            recoveryOfTurnId: null,
            timestamp: new Date().toISOString(),
            transcriptPreview: "Repeating the last point in a tighter version.",
            estimatedPlaybackMs: 1800,
            audioFormat: PATHLY_AUDIO_FORMAT
          });
          emit(socket, "playback.filler", {
            turnId: filler.turnId,
            speaker: filler.speaker,
            segmentType: filler.segmentType,
            turnType: filler.turnType,
            priority: filler.priority,
            supersedesTurnId: filler.supersedesTurnId,
            recoveryOfTurnId: filler.recoveryOfTurnId,
            timestamp: filler.timestamp,
            transcriptPreview: filler.transcriptPreview,
            estimatedPlaybackMs: filler.estimatedPlaybackMs,
            audioFormat: filler.audioFormat
          });
          filler.audioChunks.forEach((audioBase64, chunkIndex) => {
            emit(socket, "playback.audio.chunk", {
              turnId: filler.turnId,
              speaker: filler.speaker,
              segmentType: filler.segmentType,
              turnType: filler.turnType,
              priority: filler.priority,
              supersedesTurnId: filler.supersedesTurnId,
              recoveryOfTurnId: filler.recoveryOfTurnId,
              timestamp: new Date().toISOString(),
              chunkIndex,
              audioBase64,
              isFinalChunk: chunkIndex === filler.audioChunks.length - 1
            });
          });
        }
        break;
      }
      case "interrupt.text": {
        const text = String(payload.text ?? "").trim();
        if (/less news/i.test(text)) {
          session.quickActionBias.local_context = (session.quickActionBias.local_context ?? 0) + 2;
          session.quickActionBias.news = 0;
        }
        if (/quiet/i.test(text)) {
          session.preferences.quietModeEnabled = true;
          session.preferences.quietModeUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        }
        const mutation = deps.schedulerService.handleUserInterrupt(
          session,
          text ? `User interrupted and needs an immediate spoken response: "${text}"` : "User interrupted and needs an immediate response."
        );
        await applyMutation(session, runtime, deps, mutation);
        break;
      }
      case "interrupt.voice.start": {
        session.voiceInterruptChunks = [];
        session.interruptedPlaybackTurnId = session.scheduler.slots.activeTurnId;
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
        const mutation = deps.schedulerService.handleUserInterrupt(
          session,
          "User interrupted by voice and needs a short immediate spoken response before the show continues."
        );
        await applyMutation(session, runtime, deps, mutation);
        session.voiceInterruptChunks = [];
        deps.sessionService.save(session);
        break;
      }
      case "session.pause": {
        deps.sessionService.setStatus(sessionId, "paused");
        break;
      }
      case "session.resume": {
        deps.sessionService.setStatus(sessionId, "active");
        break;
      }
      case "session.end": {
        deps.sessionService.setStatus(sessionId, "ended");
        runtimes.delete(sessionId);
        break;
      }
      case "session.preferences.update": {
        const parsed = sessionPreferencesSchema.safeParse(payload.preferences);
        if (!parsed.success) {
          throw new Error("Invalid session.preferences.update payload");
        }
        deps.sessionService.updatePreferences(sessionId, parsed.data);
        const updatedSession = deps.sessionService.get(sessionId);
        emit(socket, "session.preferences.updated", {
          sessionId,
          preferences: updatedSession?.preferences ?? parsed.data
        });
        break;
      }
      default:
        sendError(socket, "unsupported_event", `Unsupported websocket event: ${message.type}`, false, "ws");
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
      false,
      "ws"
    );
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
