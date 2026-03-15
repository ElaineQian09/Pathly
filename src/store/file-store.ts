import fs from "node:fs";
import path from "node:path";
import type { RunSession, UserProfile } from "../models/types.js";

type PersistedState = {
  profile: UserProfile | null;
  sessions: RunSession[];
};

const defaultState = (): PersistedState => ({
  profile: null,
  sessions: []
});

export class FileStore {
  private readonly statePath: string;
  private state: PersistedState;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.statePath = path.join(dataDir, "state.json");
    this.state = this.load();
  }

  private load(): PersistedState {
    if (!fs.existsSync(this.statePath)) {
      return defaultState();
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.statePath, "utf8")) as PersistedState;
      return {
        profile: parsed.profile ?? null,
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : []
      };
    } catch {
      return defaultState();
    }
  }

  private persist(): void {
    const tmpPath = `${this.statePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmpPath, this.statePath);
  }

  getProfile(): UserProfile | null {
    return this.state.profile;
  }

  setProfile(profile: UserProfile): UserProfile {
    this.state.profile = profile;
    this.persist();
    return profile;
  }

  getSession(sessionId: string): RunSession | undefined {
    return this.state.sessions.find((session) => session.sessionId === sessionId);
  }

  getSessionByResumeToken(resumeToken: string): RunSession | undefined {
    return this.state.sessions.find((session) =>
      session.checkpoints.some((checkpoint) => checkpoint.resumeToken === resumeToken)
    );
  }

  listSessions(): RunSession[] {
    return this.state.sessions;
  }

  saveSession(session: RunSession): RunSession {
    const existingIndex = this.state.sessions.findIndex((item) => item.sessionId === session.sessionId);
    if (existingIndex >= 0) {
      this.state.sessions[existingIndex] = session;
    } else {
      this.state.sessions.push(session);
    }
    this.persist();
    return session;
  }
}
