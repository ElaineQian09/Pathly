import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import {
  GeneratedAudioMessage,
  PATHLY_AUDIO_FORMAT,
  createGeneratedAudioMessageFromPcm,
  parseLiveAudioMimeType
} from "../audio/pcm.js";
import { logger } from "../logger.js";
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

export const buildLiveSetupPayload = (
  liveModel: string,
  liveVoice: string,
  systemInstruction: string
) => ({
  setup: {
    model: `models/${liveModel}`,
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: liveVoice
          }
        }
      }
    },
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    },
    outputAudioTranscription: {}
  }
});

const buildDurationGuidance = (targetDurationSeconds: number) => {
  if (targetDurationSeconds <= 12) {
    return [
      "Keep this extremely concise.",
      "Prefer one clear point only.",
      "Use short spoken sentences.",
      "If multiple buckets are present, prioritize the most important one and keep supporting detail minimal."
    ].join(" ");
  }

  if (targetDurationSeconds <= 20) {
    return [
      "Keep this compact but natural.",
      "Cover one or two points with smooth spoken transitions.",
      "Stay focused and route-aware."
    ].join(" ");
  }

  return [
    "You may be more expressive here.",
    "Connect the route context with one or two supporting details.",
    "Stay spoken, route-aware, and focused."
  ].join(" ");
};

const HOST_STYLE_MODIFIER: Record<string, string> = {
  balanced: "Keep the tone friendly, natural, and consistent. Neither too hyped nor too flat.",
  encouraging: "Lean into positive reinforcement. Celebrate small wins, name the effort, keep the runner feeling capable.",
  sarcastic: "Use dry wit and light sarcasm freely. Keep it playful and self-aware — never punching down at the runner.",
  coach: "Be direct and action-oriented. Give clear, specific cues. Keep the runner focused on execution, not feelings.",
  zen: "Stay calm and unhurried. Speak with quiet confidence. Let space exist between ideas.",
  sports_radio: "Be punchy and high-energy. Use vivid sports-commentary language. Build tension and release it."
};

const buildSpeakerPersona = (speaker: string, hostStyle: string): string => {
  const styleModifier = HOST_STYLE_MODIFIER[hostStyle] ?? HOST_STYLE_MODIFIER.balanced;

  if (speaker === "maya") {
    return [
      "You are Maya, the lead host of Pathly — a live running podcast that plays in the runner's ears during real outdoor runs.",
      "Maya is warm, curious, and energetic. She sets the emotional tone for each stretch of the run.",
      "She speaks in short, punchy sentences that feel natural at running pace — never breathless, never lecture-like.",
      "She notices the route: landmarks coming up, terrain shifting, the distance still ahead. She makes these feel worth running toward.",
      "She's genuinely interested in the people and places the runner is passing through. Local color energizes her.",
      "She motivates without being preachy. She knows the difference between a runner who needs a push and one who just needs company.",
      "When handing off to Theo, she sets him up with an open thread rather than wrapping things too neatly.",
      "She never explains her own jokes. She never recaps what Theo just said.",
      "Keep all output as natural spoken English. No stage directions, no markdown, no bullet points.",
      `Style for this run: ${styleModifier}`
    ].join(" ");
  }

  return [
    "You are Theo, the second host of Pathly — a live running podcast that plays in the runner's ears during real outdoor runs.",
    "Theo is dry, observational, and quietly funny. He is the counterpoint to Maya's lead energy.",
    "He picks up whatever thread Maya left and takes it somewhere unexpected — a wry angle, a surprising fact, a deadpan callback.",
    "His humor is understated. He lets the joke land without explaining it. He is never loud about being funny.",
    "He handles news and run metrics with a light touch — he makes stats feel grounded and relevant, not like a readout.",
    "He is occasionally self-deprecating but never self-pitying. He is never mean toward the runner.",
    "He wraps topics cleanly and leaves a clear path back to the route or the runner's current state.",
    "He never repeats what Maya just said. He never over-explains. He trusts the runner to keep up.",
    "Keep all output as natural spoken English. No stage directions, no markdown, no bullet points.",
    `Style for this run: ${styleModifier}`
  ].join(" ");
};

const buildPlaybackPrompt = (
  plan: TurnPlan,
  session: RunSession,
  places: PlaceCandidate[],
  news: NewsItem[]
) =>
  [
    `Speaker: ${plan.speaker}.`,
    `Host style: ${session.preferences.hostStyle}.`,
    `Content buckets: ${plan.contentBuckets.join(", ")}.`,
    `Target duration seconds: ${plan.targetDurationSeconds}.`,
    `Narration guidance: ${buildDurationGuidance(plan.targetDurationSeconds)}`,
    `Place facts: ${places.map((place) => place.fact).join(" | ") || "none"}.`,
    `News candidates: ${news.map((item) => item.headline).join(" | ") || "none"}.`,
    "Respond as short spoken audio in English. Keep it route-aware and natural.",
    "Do not add stage directions or markdown."
  ].join("\n");

const buildInterruptPrompt = (session: RunSession, intent: string, transcriptPreview: string) =>
  [
    `Host style: ${session.preferences.hostStyle}.`,
    `Interrupt intent: ${intent}.`,
    `Suggested response direction: ${transcriptPreview}.`,
    "Answer the interruption directly and stop cleanly. 1 or 2 spoken sentences maximum.",
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
    private readonly mayaVoice: string,
    private readonly theoVoice: string,
    private readonly liveAudioTimeoutMs: number
  ) {}

  private voiceForSpeaker(speaker: string): string {
    return speaker === "theo" ? this.theoVoice : this.mayaVoice;
  }

  private async synthesizeLiveAudio<T extends PlaybackSegment | InterruptResult>(
    metadata: T,
    systemInstruction: string,
    userPrompt: string,
    voice: string
  ): Promise<GeneratedAudioMessage<T> | null> {
    if (!this.apiKey) {
      logger.warn("gemini.live.unavailable", {
        turnId: metadata.turnId,
        reason: "missing_api_key"
      });
      throw new Error("Gemini Live is unavailable: missing API key.");
    }

    return await new Promise<GeneratedAudioMessage<T> | null>((resolve, reject) => {
      const socket = new WebSocket(`${LIVE_URL}?key=${this.apiKey}`);
      const audioParts: Buffer[] = [];
      let transcript = metadata.transcriptPreview;
      let audioMimeType: string | null = null;
      let completed = false;
      let setupAcknowledged = false;
      let messageCount = 0;
      let audioPartCount = 0;

      const timeout = setTimeout(() => {
        socket.close();
        reject(
          new Error(
            `Gemini Live audio generation timed out after ${this.liveAudioTimeoutMs}ms.`
          )
        );
      }, this.liveAudioTimeoutMs);

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
          logger.info("gemini.live.turn.completed", {
            turnId: metadata.turnId,
            messageCount,
            audioPartCount,
            transcriptLength: (transcript || metadata.transcriptPreview).length
          });
          logger.info("gemini.live.audio.received", {
            turnId: metadata.turnId,
            speaker: metadata.speaker,
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
        logger.info("gemini.live.socket.open", {
          turnId: metadata.turnId,
          model: this.liveModel,
          voice,
          timeoutMs: this.liveAudioTimeoutMs
        });
        socket.send(
          JSON.stringify(buildLiveSetupPayload(this.liveModel, voice, systemInstruction))
        );
      });

      socket.on("message", (raw) => {
        try {
          messageCount += 1;
          const message = JSON.parse(raw.toString()) as LiveServerMessage;
          if (message.error?.message) {
            logger.error("gemini.live.server.error", {
              turnId: metadata.turnId,
              model: this.liveModel,
              message: message.error.message
            });
            throw new Error(message.error.message);
          }

          if (message.setupComplete && !setupAcknowledged) {
            setupAcknowledged = true;
            logger.info("gemini.live.setup.complete", {
              turnId: metadata.turnId
            });
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
            logger.info("gemini.live.prompt.sent", {
              turnId: metadata.turnId,
              promptLength: userPrompt.length,
              systemInstructionLength: systemInstruction.length
            });
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
              audioPartCount += 1;
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
        logger.warn("gemini.live.socket.error", {
          turnId: metadata.turnId,
          model: this.liveModel,
          message: error instanceof Error ? error.message : String(error)
        });
        reject(error);
      });

      socket.on("close", (code, reason) => {
        logger.info("gemini.live.socket.closed", {
          turnId: metadata.turnId,
          model: this.liveModel,
          code,
          reason: reason.toString(),
          completed
        });
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
      logger.info("gemini.live.playback.start", {
        turnId: plan.turnId,
        speaker: plan.speaker,
        model: this.liveModel,
        buckets: plan.contentBuckets,
        placeCount: places.length,
        newsCount: news.length
      });
      const message = await this.synthesizeLiveAudio(
        metadata,
        buildSpeakerPersona(plan.speaker, session.preferences.hostStyle),
        buildPlaybackPrompt(plan, session, places, news),
        this.voiceForSpeaker(plan.speaker)
      );
      if (message) {
        logger.info("gemini.live.playback.success", {
          turnId: plan.turnId,
          speaker: plan.speaker,
          chunkCount: message.audioChunks.length,
          transcriptLength: message.transcriptPreview.length
        });
        return message;
      }
    } catch (error) {
      logger.warn("gemini.live.playback.error", {
        turnId: plan.turnId,
        speaker: plan.speaker,
        message: error instanceof Error ? error.message : String(error)
      });
      throw (error instanceof Error ? error : new Error(String(error)));
    }

    logger.warn("gemini.live.playback.empty", {
      turnId: plan.turnId,
      speaker: plan.speaker,
      reason: "live_returned_null"
    });
    throw new Error("Gemini Live returned no audio message.");
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
      logger.info("gemini.live.interrupt.start", {
        turnId,
        intent
      });
      const message = await this.synthesizeLiveAudio(
        metadata,
        buildSpeakerPersona(metadata.speaker, session.preferences.hostStyle),
        buildInterruptPrompt(session, intent, transcriptPreview),
        this.voiceForSpeaker(metadata.speaker)
      );
      if (message) {
        logger.info("gemini.live.interrupt.success", {
          turnId,
          intent,
          chunkCount: message.audioChunks.length,
          transcriptLength: message.transcriptPreview.length
        });
        return message;
      }
    } catch (error) {
      logger.warn("gemini.live.interrupt.error", {
        turnId,
        message: error instanceof Error ? error.message : String(error)
      });
      throw (error instanceof Error ? error : new Error(String(error)));
    }

    logger.warn("gemini.live.interrupt.empty", {
      turnId,
      intent,
      reason: "live_returned_null"
    });
    throw new Error("Gemini Live returned no audio message.");
  }
}
