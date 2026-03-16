import { randomUUID } from "node:crypto";
import { GeneratedAudioMessage, PATHLY_AUDIO_FORMAT, createGeneratedAudioMessage } from "../audio/pcm.js";
import { requireOk } from "./http.js";
import { MockGeminiAdapter } from "./gemini-adapter.js";
import type {
  InterruptResult,
  NewsItem,
  PlaceCandidate,
  PlaybackSegment,
  RunSession,
  TurnPlan
} from "../models/types.js";

type GenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

const extractText = (response: GenerateContentResponse): string | null =>
  response.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim() || null;

export class RealGeminiAdapter {
  constructor(
    private readonly apiKey: string | null,
    private readonly model: string,
    private readonly fallback: MockGeminiAdapter
  ) {}

  private async generate(prompt: string): Promise<string | null> {
    if (!this.apiKey) {
      return null;
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 180
          }
        })
      }
    );

    await requireOk(response, "Gemini API");
    return extractText((await response.json()) as GenerateContentResponse);
  }

  async composePlayback(
    plan: TurnPlan,
    session: RunSession,
    places: PlaceCandidate[],
    news: NewsItem[]
  ): Promise<GeneratedAudioMessage<PlaybackSegment>> {
    const prompt = [
      "You are writing an English-first spoken preview for Pathly.",
      "Pathly is a content-first running podcast with exactly one active speaking lane.",
      `Speaker: ${plan.speaker}.`,
      `Host style: ${session.preferences.hostStyle}.`,
      `Buckets: ${plan.contentBuckets.join(", ")}.`,
      `Target seconds: ${plan.targetDurationSeconds}.`,
      `Place facts: ${places.map((place) => place.fact).join(" | ") || "none"}.`,
      `News candidates: ${news.map((item) => item.headline).join(" | ") || "none"}.`,
      "Write 2 to 4 concise sentences. Keep it natural, route-aware, and spoken in English."
    ].join("\n");

    const text = await this.generate(prompt);
    if (!text) {
      return this.fallback.composePlayback(plan, session, places, news);
    }

    return createGeneratedAudioMessage({
      turnId: plan.turnId,
      speaker: plan.speaker,
      segmentType: "main_turn",
      transcriptPreview: text,
      estimatedPlaybackMs: Math.max(1800, plan.targetDurationSeconds * 900),
      audioFormat: PATHLY_AUDIO_FORMAT
    });
  }

  async composeInterruptResult(
    session: RunSession,
    intent: string,
    transcriptPreview: string
  ): Promise<GeneratedAudioMessage<InterruptResult>> {
    const prompt = [
      "You are writing an English-first interrupt response for Pathly.",
      `Current style: ${session.preferences.hostStyle}.`,
      `Intent: ${intent}.`,
      `Fallback instruction: ${transcriptPreview}.`,
      "Write a short spoken response in 1 or 2 sentences."
    ].join("\n");

    const text = await this.generate(prompt);
    if (!text) {
      return this.fallback.composeInterruptResult(session, intent, transcriptPreview);
    }

    const turnId = `turn_${randomUUID()}`;
    return createGeneratedAudioMessage({
      turnId,
      speaker: session.currentSpeaker === "maya" ? "theo" : "maya",
      segmentType: "interrupt_response",
      transcriptPreview: text,
      estimatedPlaybackMs: Math.max(1400, text.length * 75),
      audioFormat: PATHLY_AUDIO_FORMAT
    });
  }
}
