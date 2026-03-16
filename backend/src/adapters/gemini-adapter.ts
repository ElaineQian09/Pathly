import { randomUUID } from "node:crypto";
import type {
  ContentBucket,
  InterruptResult,
  NewsItem,
  PlaceCandidate,
  PlaybackSegment,
  RunSession,
  TurnPlan
} from "../models/types.js";

const bucketLine = (bucket: ContentBucket, places: PlaceCandidate[], news: NewsItem[]) => {
  switch (bucket) {
    case "navigation":
      return "Stay alert for the next maneuver while keeping your rhythm under control.";
    case "local_context":
      return places[0]?.fact ?? "This stretch opens into a useful local detail worth noticing.";
    case "news":
      return news[0] ? `${news[0].headline}. ${news[0].summary}` : "No fresh news made the cut for this moment.";
    case "nudge":
      return "Keep the effort smooth for the next minute and let the pace settle before you push.";
    case "run_metrics":
      return "Your run metrics say the effort is holding together, so stay patient and efficient.";
    case "banter":
      return "Maya and Theo keep the continuity tight so the show never feels reset between turns.";
  }
};

export class MockGeminiAdapter {
  composePlayback(plan: TurnPlan, session: RunSession, places: PlaceCandidate[], news: NewsItem[]): PlaybackSegment {
    const opener = plan.speaker === "maya" ? "Maya:" : "Theo:";
    const lines = plan.contentBuckets.map((bucket) => bucketLine(bucket, places, news));
    const transcriptPreview = `${opener} ${lines.join(" ")}`.trim();
    return {
      turnId: plan.turnId,
      speaker: plan.speaker,
      segmentType: plan.segmentType,
      audioUrl: `https://example.com/audio/${plan.turnId}.mp3`,
      transcriptPreview,
      safeInterruptAfterMs: plan.safeInterruptAfterMs,
      estimatedPlaybackMs: Math.max(1800, plan.targetDurationSeconds * 900)
    };
  }

  composeInterruptResult(session: RunSession, intent: string, transcriptPreview: string): InterruptResult {
    const turnId = `turn_${randomUUID()}`;
    return {
      turnId,
      speaker: session.currentSpeaker === "maya" ? "theo" : "maya",
      segmentType: "interrupt_response",
      intent,
      audioUrl: `https://example.com/audio/${turnId}.mp3`,
      transcriptPreview
    };
  }
}
