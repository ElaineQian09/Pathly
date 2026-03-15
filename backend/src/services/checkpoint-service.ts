import type { RunSession, SessionCheckpoint } from "../models/types.js";
import { SessionService } from "./session-service.js";

export class CheckpointService {
  constructor(private readonly sessionService: SessionService) {}

  createCheckpoint(session: RunSession): SessionCheckpoint {
    const checkpoint: SessionCheckpoint = {
      sessionId: session.sessionId,
      transcriptSummary: `Recent buckets: ${session.recentBuckets.slice(-4).join(", ") || "none"}. Current speaker: ${session.currentSpeaker}.`,
      currentSpeaker: session.currentSpeaker,
      routeProgressMeters: session.latestSnapshot?.nav.distanceAlongRouteMeters ?? 0,
      preferences: session.preferences,
      resumeToken: `resume_${session.sessionId}`,
      createdAt: new Date().toISOString()
    };
    session.checkpoints.push(checkpoint);
    this.sessionService.save(session);
    return checkpoint;
  }
}
