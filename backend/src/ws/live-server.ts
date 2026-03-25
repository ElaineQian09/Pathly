import { randomUUID } from "node:crypto";
import { Server as HttpServer } from "node:http";
import { WebSocketServer } from "ws";
import { GeneratedAudioMessage, PATHLY_AUDIO_FORMAT, createGeneratedAudioMessage } from "../audio/pcm.js";
import { logger } from "../logger.js";
import {
  InterruptResult,
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
import { SessionService } from "../services/session-service.js";

type GeminiAdapterLike = {
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

const parseJson = (raw: string) => JSON.parse(raw) as { type: string; payload: Record<string, unknown> };

const sendError = (socket: SocketLike, code: string, message: string) => {
  socket.send(JSON.stringify({
    type: "error",
    payload: {
      code,
      message
    }
  }));
};

const sendAudioChunks = (socket: SocketLike, sessionId: string, turnId: string, audioChunks: string[]) => {
  audioChunks.forEach((audioBase64, chunkIndex) => {
    const chunk: PlaybackAudioChunk = {
      turnId,
      chunkIndex,
      audioBase64,
      isFinalChunk: chunkIndex === audioChunks.length - 1
    };
    logger.info("ws.playback.audio.chunk.sent", {
      sessionId,
      turnId,
      chunkIndex,
      isFinalChunk: chunk.isFinalChunk,
      chunkByteLength: Buffer.byteLength(audioBase64, "base64")
    });
    socket.send(JSON.stringify({
      type: "playback.audio.chunk",
      payload: chunk
    }));
  });
};

const sendSegmentWithAudio = (
  socket: SocketLike,
  sessionId: string,
  eventType: "playback.segment" | "playback.filler" | "interrupt.result",
  message: GeneratedAudioMessage<PlaybackSegment | PlaybackFiller | InterruptResult>
) => {
  const { audioChunks, ...metadata } = message;
  const actualAudioBytes = audioChunks.reduce((total, chunk) => total + Buffer.byteLength(chunk, "base64"), 0);
  logger.info("ws.playback.segment.sent", {
    sessionId,
    eventType,
    turnId: metadata.turnId,
    speaker: metadata.speaker,
    segmentType: metadata.segmentType,
    estimatedPlaybackMs: metadata.estimatedPlaybackMs,
    sampleRateHz: metadata.audioFormat.sampleRateHz,
    channelCount: metadata.audioFormat.channelCount,
    actualAudioBytes,
    chunkCount: audioChunks.length
  });
  socket.send(JSON.stringify({
    type: eventType,
    payload: metadata
  }));
  sendAudioChunks(socket, sessionId, metadata.turnId, audioChunks);
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
    sessionIdForLog = sessionId;
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
        logger.info("ws.context.snapshot.received", {
          sessionId,
          elapsedSeconds: parsed.data.motion.elapsedSeconds,
          offRoute: parsed.data.nav.offRoute,
          approachingManeuver: parsed.data.nav.approachingManeuver,
          quietModeEnabled: session.preferences.quietModeEnabled,
          quietModeUntil: session.preferences.quietModeUntil
        });
        stage = "context.snapshot.persist_snapshot";
        session.latestSnapshot = parsed.data;
        deps.sessionService.save(session);
        stage = "context.snapshot.create_checkpoint";
        const checkpoint = deps.checkpointService.createCheckpoint(session);
        logger.info("ws.checkpoint.created", {
          sessionId,
          checkpointCount: session.checkpoints.length,
          resumeToken: checkpoint.resumeToken ?? `resume_${sessionId}`
        });
        stage = "context.snapshot.create_plan";
        const plan = deps.routerService.createPlan(session, parsed.data);
        if (plan) {
          logger.info("ws.turn.plan.created", {
            sessionId,
            turnId: plan.turnId,
            speaker: plan.speaker,
            reason: plan.reason,
            buckets: plan.contentBuckets,
            targetDurationSeconds: plan.targetDurationSeconds
          });
          deps.sessionService.save(session);
          stage = "context.snapshot.fetch_places";
          const placesStartedAt = Date.now();
          logger.info("ws.places.fetch.start", {
            sessionId,
            turnId: plan.turnId,
            routeId: session.routeSelection.selectedRouteId
          });
          const places = await deps.placeService.getCandidates(parsed.data, session.routeSelection);
          logger.info("ws.places.fetch.done", {
            sessionId,
            turnId: plan.turnId,
            placeCount: places.length,
            durationMs: Date.now() - placesStartedAt
          });
          stage = "context.snapshot.fetch_news";
          const newsStartedAt = Date.now();
          logger.info("ws.news.fetch.start", {
            sessionId,
            turnId: plan.turnId,
            categories: session.preferences.newsCategories
          });
          const news = await deps.newsService.getCandidates(session.preferences);
          logger.info("ws.news.fetch.done", {
            sessionId,
            turnId: plan.turnId,
            newsCount: news.length,
            durationMs: Date.now() - newsStartedAt
          });
          logger.info("ws.turn.composition.started", {
            sessionId,
            turnId: plan.turnId,
            placeCount: places.length,
            newsCount: news.length,
            buckets: plan.contentBuckets
          });
          stage = "context.snapshot.compose_playback";
          const playbackStartedAt = Date.now();
          logger.info("ws.gemini.playback.start", {
            sessionId,
            turnId: plan.turnId,
            speaker: plan.speaker,
            buckets: plan.contentBuckets,
            placeCount: places.length,
            newsCount: news.length
          });
          let segment: GeneratedAudioMessage<PlaybackSegment>;
          try {
            segment = await deps.geminiAdapter.composePlayback(plan, session, places, news);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.warn("ws.gemini.playback.failed", {
              sessionId,
              turnId: plan.turnId,
              speaker: plan.speaker,
              message
            });
            sendError(socket, "live_playback_failed", message);
            break;
          }
          logger.info("ws.gemini.playback.done", {
            sessionId,
            turnId: plan.turnId,
            durationMs: Date.now() - playbackStartedAt,
            chunkCount: segment.audioChunks.length,
            transcriptLength: segment.transcriptPreview.length
          });
          logger.info("ws.turn.generated", {
            sessionId,
            turnId: plan.turnId,
            speaker: plan.speaker,
            reason: plan.reason,
            buckets: plan.contentBuckets
          });
          stage = "context.snapshot.emit_turn";
          logger.info("ws.turn.emit.start", {
            sessionId,
            turnId: plan.turnId,
            eventType: "playback.segment"
          });
          socket.send(JSON.stringify({ type: "turn.plan", payload: plan }));
          sendSegmentWithAudio(socket, sessionId, "playback.segment", segment);
        } else {
          logger.info("ws.turn.skipped", {
            sessionId,
            reason: "router_returned_null",
            quietModeEnabled: session.preferences.quietModeEnabled,
            quietModeUntil: session.preferences.quietModeUntil,
            offRoute: parsed.data.nav.offRoute,
            approachingManeuver: parsed.data.nav.approachingManeuver
          });
        }

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
          sendSegmentWithAudio(
            socket,
            sessionId,
            "playback.filler",
            createGeneratedAudioMessage({
              turnId: `filler_${randomUUID()}`,
              speaker: session.currentSpeaker,
              segmentType: "filler",
              transcriptPreview: "Repeating the last point in a tighter version.",
              estimatedPlaybackMs: 1800,
              audioFormat: PATHLY_AUDIO_FORMAT
            })
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
        let interruptMessage: GeneratedAudioMessage<InterruptResult>;
        try {
          interruptMessage = await deps.geminiAdapter.composeInterruptResult(
            session,
            intent,
            intent === "preference_change"
              ? "Got it. I updated the run settings and the next turns will follow that immediately."
              : "I heard you. I will answer directly first, then bring the show back in cleanly."
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.warn("ws.gemini.interrupt.failed", {
            sessionId,
            intent,
            message
          });
          sendError(socket, "live_playback_failed", message);
          break;
        }
        sendSegmentWithAudio(
          socket,
          sessionId,
          "interrupt.result",
          interruptMessage
        );
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
        let interruptMessage: GeneratedAudioMessage<InterruptResult>;
        try {
          interruptMessage = await deps.geminiAdapter.composeInterruptResult(
            session,
            "direct_answer",
            "I heard the interruption and I am switching to a short direct response before resuming the show."
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.warn("ws.gemini.interrupt.failed", {
            sessionId,
            intent: "direct_answer",
            message
          });
          sendError(socket, "live_playback_failed", message);
          session.voiceInterruptChunks = [];
          deps.sessionService.save(session);
          break;
        }
        sendSegmentWithAudio(
          socket,
          sessionId,
          "interrupt.result",
          interruptMessage
        );
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
      sendError(socket, "unsupported_event", `Unsupported websocket event: ${message.type}`);
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
      error instanceof Error ? error.message : "Invalid websocket message"
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
