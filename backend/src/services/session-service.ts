import { randomUUID } from "node:crypto";
import type {
  CreateSessionRequest,
  RunSession,
  SessionPreferences,
  Speaker
} from "../models/types.js";
import { FileStore } from "../store/file-store.js";

const nextSpeaker = (preferredSpeakers: Speaker[]): Speaker => preferredSpeakers[0] ?? "maya";

export class SessionService {
  constructor(private readonly store: FileStore) {}

  create(request: CreateSessionRequest): RunSession {
    const sessionId = `sess_${randomUUID()}`;
    const preferences: SessionPreferences = {
      hostStyle: request.profile.hostStyle,
      newsCategories: request.profile.newsCategories,
      newsDensity: request.profile.newsDensity,
      talkDensity: request.profile.talkDensityDefault,
      quietModeEnabled: request.profile.quietModeDefault,
      quietModeUntil: null
    };
    const openingSpeaker = nextSpeaker(request.profile.preferredSpeakers);
    const session: RunSession = {
      sessionId,
      status: "connecting",
      openingSpeaker,
      profile: request.profile,
      routeSelection: request.routeSelection,
      preferences,
      latestSnapshot: null,
      currentSpeaker: openingSpeaker,
      recentBuckets: [],
      lastTurnAt: null,
      lastRunMetricsAtSeconds: null,
      lastAreaKey: null,
      newsTurnCounter: 0,
      quickActionBias: {},
      checkpoints: [],
      conversationHistory: [],
      reconnectIssued: false,
      voiceInterruptChunks: [],
      interruptedPlaybackTurnId: null
    };
    return this.store.saveSession(session);
  }

  get(sessionId: string): RunSession | undefined {
    return this.store.getSession(sessionId);
  }

  getByResumeToken(resumeToken: string): RunSession | undefined {
    return this.store.getSessionByResumeToken(resumeToken);
  }

  save(session: RunSession): RunSession {
    return this.store.saveSession(session);
  }

  updatePreferences(sessionId: string, preferences: SessionPreferences): RunSession | undefined {
    const session = this.store.getSession(sessionId);
    if (!session) {
      return undefined;
    }
    session.preferences = preferences;
    return this.store.saveSession(session);
  }

  setStatus(sessionId: string, status: RunSession["status"]): RunSession | undefined {
    const session = this.store.getSession(sessionId);
    if (!session) {
      return undefined;
    }
    session.status = status;
    return this.store.saveSession(session);
  }
}
