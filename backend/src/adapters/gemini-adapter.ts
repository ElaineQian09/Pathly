import { createGeneratedAudioMessage, PATHLY_AUDIO_FORMAT } from "../audio/pcm.js";
import type { TurnStreamCallbacks, TurnStreamHandle } from "./live-turn-stream.js";
import type {
  ContentBucket,
  NewsItem,
  PlaceCandidate,
  PlaybackSegment,
  RunSession,
  TurnPlan
} from "../models/types.js";

const bucketLine = (bucket: ContentBucket, places: PlaceCandidate[], news: NewsItem[]) => {
  switch (bucket) {
    case "local_context":
      return places[0]?.fact ?? "This stretch opens into a useful local detail worth noticing.";
    case "news":
      return news[0] ? `${news[0].headline}. ${news[0].summary}` : "No fresh news made the cut for this moment.";
    case "nudge":
      return "Keep the effort smooth for the next minute and let the pace settle before you push.";
    case "run_metrics":
      return "Your run metrics say the effort is holding together, so stay patient and efficient.";
    case "nav_lite":
      return "Keep the route cue crisp and immediate so the runner knows what matters next.";
    case "banter":
      return "Maya and Theo keep the continuity tight so the show never feels reset between turns.";
  }
};

export class MockGeminiAdapter {
  streamPlayback(
    plan: TurnPlan,
    session: RunSession,
    places: PlaceCandidate[],
    news: NewsItem[],
    callbacks: TurnStreamCallbacks<PlaybackSegment>
  ): TurnStreamHandle {
    let cancelled = false;
    const opener = plan.speaker === "maya" ? "Maya:" : "Theo:";
    const transcriptPreview = [
      opener,
      plan.priority !== "P2" ? `(${plan.triggerType})` : "",
      ...plan.contentBuckets.map((bucket) => bucketLine(bucket, places, news))
    ]
      .join(" ")
      .trim();

    const message = createGeneratedAudioMessage({
      turnId: plan.turnId,
      speaker: plan.speaker,
      segmentType: "main_turn",
      turnType: plan.turnType,
      priority: plan.priority,
      supersedesTurnId: plan.supersedesTurnId,
      recoveryOfTurnId: plan.recoveryOfTurnId,
      timestamp: plan.timestamp,
      transcriptPreview,
      estimatedPlaybackMs: Math.max(1600, plan.targetDurationSeconds * 900),
      audioFormat: PATHLY_AUDIO_FORMAT
    });

    callbacks.onSegmentReady({
      turnId: message.turnId,
      speaker: message.speaker,
      segmentType: "main_turn",
      turnType: message.turnType,
      priority: message.priority,
      supersedesTurnId: message.supersedesTurnId,
      recoveryOfTurnId: message.recoveryOfTurnId,
      timestamp: message.timestamp,
      transcriptPreview: message.transcriptPreview,
      estimatedPlaybackMs: message.estimatedPlaybackMs,
      audioFormat: message.audioFormat
    });

    const completed = Promise.resolve().then(() => {
      for (let index = 0; index < message.audioChunks.length; index += 1) {
        if (cancelled) {
          break;
        }
        callbacks.onChunk({
          chunkIndex: index,
          audioBase64: message.audioChunks[index],
          isFinalChunk: index === message.audioChunks.length - 1,
          transcriptPreview: message.transcriptPreview
        });
      }

      const summary = {
        transcriptPreview: message.transcriptPreview,
        estimatedPlaybackMs: message.estimatedPlaybackMs,
        chunkCount: message.audioChunks.length
      };
      if (!cancelled) {
        callbacks.onComplete(summary);
      }
      return summary;
    }).catch((error) => {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    });

    return {
      cancel() {
        cancelled = true;
      },
      completed
    };
  }
}
