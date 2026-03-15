import { Server as HttpServer } from "node:http";
import { WebSocketServer } from "ws";
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

    switch (message.type) {
      case "session.join": {
        if (resumeToken && session.status === "reconnecting") {
          session.reconnectIssued = false;
          deps.sessionService.save(session);
        }
        deps.sessionService.setStatus(sessionId, "active");
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
          socket.send(JSON.stringify({ type: "turn.plan", payload: plan }));
          socket.send(JSON.stringify({ type: "playback.segment", payload: segment }));
        }

        if (!session.reconnectIssued && parsed.data.motion.elapsedSeconds >= 1800) {
          session.reconnectIssued = true;
          deps.sessionService.setStatus(sessionId, "reconnecting");
          deps.sessionService.save(session);
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
        break;
      }
      case "interrupt.voice.chunk": {
        session.voiceInterruptChunks.push(String(payload.audioBase64 ?? ""));
        deps.sessionService.save(session);
        break;
      }
      case "interrupt.voice.end": {
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
        break;
      }
      case "session.resume": {
        deps.sessionService.setStatus(sessionId, "active");
        break;
      }
      case "session.end": {
        deps.sessionService.setStatus(sessionId, "ended");
        break;
      }
      case "session.preferences.update": {
        const parsed = sessionPreferencesSchema.safeParse(payload.preferences);
        if (!parsed.success) {
          throw new Error("Invalid session.preferences.update payload");
        }
        deps.sessionService.updatePreferences(sessionId, parsed.data);
        const updatedSession = deps.sessionService.get(sessionId);
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
        socket.send(JSON.stringify({
          type: "error",
          payload: {
            code: "unsupported_event",
            message: `Unsupported websocket event: ${message.type}`
          }
        }));
    }
  } catch (error) {
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
    if (!pathname.startsWith("/v1/live")) {
      socket.close();
      return;
    }
    socket.on("message", (data) => {
      void handleWsMessage(socket, deps, data.toString());
    });
  });

  return wss;
};
