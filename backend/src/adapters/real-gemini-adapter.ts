import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import {
  GeneratedAudioMessage,
  PATHLY_AUDIO_FORMAT,
  createGeneratedAudioMessageFromPcm,
  parseLiveAudioMimeType
} from "../audio/pcm.js";
import { logger } from "../logger.js";
import { MockGeminiAdapter } from "./gemini-adapter.js";
import type {
  InterruptResult,
  NewsItem,
  PlaceCandidate,
  PlaybackSegment,
  RunSession,
  TurnPlan
} from "../models/types.js";

type LiveInlineData = {
  data?: string;
  mimeType?: string;
};

type LivePart = {
  inlineData?: LiveInlineData;
  text?: string;
};

type LiveServerMessage = {
  setupComplete?: Record<string, never>;
  serverContent?: {
    modelTurn?: {
      parts?: LivePart[];
    };
    outputTranscription?: {
      text?: string;
    };
    turnComplete?: boolean;
    interrupted?: boolean;
  };
  goAway?: {
    timeLeft?: string;
  };
  error?: {
    message?: string;
  };
};

const LIVE_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

const buildPlaybackPrompt = (
  plan: TurnPlan,
  session: RunSession,
  places: PlaceCandidate[],
  news: NewsItem[]
) =>
  [
    "You are speaking for Pathly, an English-first running podcast with exactly one active speaking lane.",
    `Speaker: ${plan.speaker}.`,
    `Host style: ${session.preferences.hostStyle}.`,
    `Content buckets: ${plan.contentBuckets.join(", ")}.`,
    `Target duration seconds: ${plan.targetDurationSeconds}.`,
    `Place facts: ${places.map((place) => place.fact).join(" | ") || "none"}.`,
    `News candidates: ${news.map((item) => item.headline).join(" | ") || "none"}.`,
    "Respond as short spoken audio in English. Keep it route-aware and natural.",
    "Do not add stage directions or markdown."
  ].join("\n");

const buildInterruptPrompt = (session: RunSession, intent: string, transcriptPreview: string) =>
  [
    "You are speaking for Pathly, an English-first running podcast with exactly one active speaking lane.",
    `Host style: ${session.preferences.hostStyle}.`,
    `Intent: ${intent}.`,
    `Fallback response target: ${transcriptPreview}.`,
    "Respond as short spoken audio in English in 1 or 2 concise sentences.",
    "Do not add stage directions or markdown."
  ].join("\n");

const updateTranscript = (current: string, next: string | undefined) => {
  const normalized = (next ?? "").trim();
  if (!normalized) {
    return current;
  }
  return normalized.length >= current.length ? normalized : current;
};

export class RealGeminiAdapter {
  constructor(
    private readonly apiKey: string | null,
    private readonly liveModel: string,
    private readonly liveVoice: string,
    private readonly fallback: MockGeminiAdapter
  ) {}

  private async synthesizeLiveAudio<T extends PlaybackSegment | InterruptResult>(
    metadata: T,
    systemInstruction: string,
    userPrompt: string
  ): Promise<GeneratedAudioMessage<T> | null> {
    if (!this.apiKey) {
      return null;
    }

    return await new Promise<GeneratedAudioMessage<T> | null>((resolve, reject) => {
      const socket = new WebSocket(`${LIVE_URL}?key=${this.apiKey}`);
      const audioParts: Buffer[] = [];
      let transcript = metadata.transcriptPreview;
      let audioMimeType: string | null = null;
      let completed = false;
      let setupAcknowledged = false;

      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error("Gemini Live audio generation timed out."));
      }, 20000);

      const finalize = () => {
        if (completed) {
          return;
        }
        completed = true;
        clearTimeout(timeout);
        try {
          if (audioParts.length === 0) {
            reject(new Error("Gemini Live returned no audio parts."));
            return;
          }
          const rawAudio = Buffer.concat(audioParts);
          const parsedFormat = parseLiveAudioMimeType(audioMimeType);
          logger.info("gemini.live.audio.received", {
            turnId: metadata.turnId,
            mimeType: audioMimeType ?? "audio/pcm;rate=24000",
            upstreamBytes: rawAudio.length,
            upstreamSampleRateHz: parsedFormat.sampleRateHz,
            upstreamChannelCount: parsedFormat.channelCount
          });
          resolve(
            createGeneratedAudioMessageFromPcm(
              {
                ...metadata,
                transcriptPreview: transcript || metadata.transcriptPreview,
                audioFormat: PATHLY_AUDIO_FORMAT
              },
              rawAudio,
              parsedFormat
            )
          );
        } catch (error) {
          reject(error);
        } finally {
          socket.close();
        }
      };

      socket.on("open", () => {
        socket.send(
          JSON.stringify({
            setup: {
              model: `models/${this.liveModel}`,
              generationConfig: {
                responseModalities: ["AUDIO"]
              },
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: this.liveVoice
                  }
                }
              },
              systemInstruction: {
                parts: [{ text: systemInstruction }]
              },
              outputAudioTranscription: {}
            }
          })
        );
      });

      socket.on("message", (raw) => {
        try {
          const message = JSON.parse(raw.toString()) as LiveServerMessage;
          if (message.error?.message) {
            throw new Error(message.error.message);
          }

          if (message.setupComplete && !setupAcknowledged) {
            setupAcknowledged = true;
            socket.send(
              JSON.stringify({
                clientContent: {
                  turns: [
                    {
                      role: "user",
                      parts: [{ text: userPrompt }]
                    }
                  ],
                  turnComplete: true
                }
              })
            );
            return;
          }

          if (message.goAway) {
            logger.warn("gemini.live.go_away", {
              turnId: metadata.turnId,
              timeLeft: message.goAway.timeLeft ?? null
            });
          }

          const serverContent = message.serverContent;
          if (!serverContent) {
            return;
          }

          transcript = updateTranscript(transcript, serverContent.outputTranscription?.text);
          for (const part of serverContent.modelTurn?.parts ?? []) {
            if (part.inlineData?.data) {
              audioParts.push(Buffer.from(part.inlineData.data, "base64"));
              audioMimeType = part.inlineData.mimeType ?? audioMimeType;
            }
            transcript = updateTranscript(transcript, part.text);
          }

          if (serverContent.interrupted) {
            throw new Error("Gemini Live interrupted the audio turn before completion.");
          }

          if (serverContent.turnComplete) {
            finalize();
          }
        } catch (error) {
          clearTimeout(timeout);
          socket.close();
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });

      socket.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      socket.on("close", () => {
        if (!completed) {
          clearTimeout(timeout);
        }
      });
    });
  }

  async composePlayback(
    plan: TurnPlan,
    session: RunSession,
    places: PlaceCandidate[],
    news: NewsItem[]
  ): Promise<GeneratedAudioMessage<PlaybackSegment>> {
    const metadata: PlaybackSegment = {
      turnId: plan.turnId,
      speaker: plan.speaker,
      segmentType: "main_turn",
      transcriptPreview: `${plan.speaker === "maya" ? "Maya" : "Theo"} is taking the next Pathly turn.`,
      estimatedPlaybackMs: Math.max(1800, plan.targetDurationSeconds * 1000),
      audioFormat: PATHLY_AUDIO_FORMAT
    };

    try {
      const message = await this.synthesizeLiveAudio(
        metadata,
        "Speak as one Pathly host. Keep the response concise, natural, English-first, and suitable for a live running show.",
        buildPlaybackPrompt(plan, session, places, news)
      );
      if (message) {
        return message;
      }
    } catch (error) {
      logger.warn("gemini.live.playback.error", {
        turnId: plan.turnId,
        message: error instanceof Error ? error.message : String(error)
      });
    }

    return this.fallback.composePlayback(plan, session, places, news);
  }

  async composeInterruptResult(
    session: RunSession,
    intent: string,
    transcriptPreview: string
  ): Promise<GeneratedAudioMessage<InterruptResult>> {
    const turnId = `turn_${randomUUID()}`;
    const metadata: InterruptResult = {
      turnId,
      speaker: session.currentSpeaker === "maya" ? "theo" : "maya",
      segmentType: "interrupt_response",
      transcriptPreview,
      estimatedPlaybackMs: Math.max(1400, transcriptPreview.length * 90),
      audioFormat: PATHLY_AUDIO_FORMAT
    };

    try {
      const message = await this.synthesizeLiveAudio(
        metadata,
        "Speak as one Pathly host. Answer the interruption directly first, in English, then stop cleanly.",
        buildInterruptPrompt(session, intent, transcriptPreview)
      );
      if (message) {
        return message;
      }
    } catch (error) {
      logger.warn("gemini.live.interrupt.error", {
        turnId,
        message: error instanceof Error ? error.message : String(error)
      });
    }

    return this.fallback.composeInterruptResult(session, intent, transcriptPreview);
  }
}
