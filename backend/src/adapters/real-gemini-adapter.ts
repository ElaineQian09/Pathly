import WebSocket from "ws";
import { PATHLY_AUDIO_FORMAT, parseLiveAudioMimeType } from "../audio/pcm.js";
import { logger } from "../logger.js";
import type { TurnStreamCallbacks, TurnStreamCompletion, TurnStreamHandle } from "./live-turn-stream.js";
import type {
  NewsItem,
  PlaceCandidate,
  PlaybackSegment,
  RunSession,
  TurnPlan
} from "../models/types.js";
import { PromptFrameService } from "../services/prompt-frame-service.js";

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

const HOST_STYLE_MODIFIER: Record<string, string> = {
  balanced: "Keep the tone friendly, natural, and consistent. Neither too hyped nor too flat.",
  encouraging: "Lean into positive reinforcement. Celebrate small wins and keep the runner feeling capable.",
  sarcastic: "Use dry wit and light sarcasm freely, but keep it playful and never mean.",
  coach: "Be direct and action-oriented. Give clear cues without sounding robotic.",
  zen: "Stay calm and unhurried. Speak with quiet confidence.",
  sports_radio: "Be punchy and high-energy. Use vivid sports-commentary language."
};

const buildSpeakerPersona = (speaker: string, hostStyle: string): string => {
  const styleModifier = HOST_STYLE_MODIFIER[hostStyle] ?? HOST_STYLE_MODIFIER.balanced;
  if (speaker === "maya") {
    return [
      "You are Maya, one of two live Pathly hosts.",
      "Maya is warm, curious, energetic, and aware of the route in front of the runner.",
      "She sounds like she is picking up an ongoing co-hosted conversation, not restarting the show.",
      styleModifier
    ].join(" ");
  }

  return [
    "You are Theo, one of two live Pathly hosts.",
    "Theo is dry, grounded, and quietly funny.",
    "He sounds like he is replying to Maya in a flowing two-host conversation.",
    styleModifier
  ].join(" ");
};

const updateTranscript = (current: string, next: string | undefined) => {
  const normalized = (next ?? "").trim();
  if (!normalized) {
    return current;
  }
  return normalized.length >= current.length ? normalized : current;
};

const playbackMsForBase64Bytes = (byteLength: number) =>
  Math.round((byteLength / (PATHLY_AUDIO_FORMAT.sampleRateHz * PATHLY_AUDIO_FORMAT.channelCount * 2)) * 1000);

export class RealGeminiAdapter {
  private readonly promptFrameService = new PromptFrameService();

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

  streamPlayback(
    plan: TurnPlan,
    session: RunSession,
    places: PlaceCandidate[],
    news: NewsItem[],
    callbacks: TurnStreamCallbacks<PlaybackSegment>
  ): TurnStreamHandle {
    const metadata: PlaybackSegment = {
      turnId: plan.turnId,
      speaker: plan.speaker,
      segmentType: "main_turn",
      turnType: plan.turnType,
      priority: plan.priority,
      supersedesTurnId: plan.supersedesTurnId,
      recoveryOfTurnId: plan.recoveryOfTurnId,
      timestamp: plan.timestamp,
      transcriptPreview: `${plan.speaker === "maya" ? "Maya" : "Theo"} is taking the next Pathly turn.`,
      estimatedPlaybackMs: Math.max(1800, plan.targetDurationSeconds * 1000),
      audioFormat: PATHLY_AUDIO_FORMAT
    };

    callbacks.onSegmentReady(metadata);

    if (!this.apiKey) {
      const error = new Error("Gemini Live is unavailable: missing API key.");
      callbacks.onError(error);
      return {
        cancel() {},
        completed: Promise.reject(error)
      };
    }

    const frame = this.promptFrameService.buildFrame(session, plan, session.latestSnapshot ?? session.previousSnapshot!, places, news);
    const systemInstruction = [
      buildSpeakerPersona(plan.speaker, session.preferences.hostStyle),
      this.promptFrameService.buildSystemInstruction(frame)
    ].join("\n");
    const userPrompt = this.promptFrameService.buildUserPrompt(frame);

    let socket: WebSocket | null = null;
    let completed = false;
    let setupAcknowledged = false;
    let messageCount = 0;
    let chunkIndex = 0;
    let totalAudioBytes = 0;
    let transcript = metadata.transcriptPreview;
    let bufferedChunk: string | null = null;
    let bufferedMimeType: string | null = null;

    const completion = new Promise<TurnStreamCompletion>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket?.close();
        reject(new Error(`Gemini Live audio generation timed out after ${this.liveAudioTimeoutMs}ms.`));
      }, this.liveAudioTimeoutMs);

      const finalize = () => {
        if (completed) {
          return;
        }
        completed = true;
        clearTimeout(timeout);

        if (!bufferedChunk && chunkIndex === 0) {
          const error = new Error("Gemini Live returned no audio parts.");
          callbacks.onError(error);
          reject(error);
          return;
        }

        if (bufferedChunk) {
          callbacks.onChunk({
            chunkIndex,
            audioBase64: bufferedChunk,
            isFinalChunk: true,
            transcriptPreview: transcript
          });
          totalAudioBytes += Buffer.byteLength(bufferedChunk, "base64");
          chunkIndex += 1;
          bufferedChunk = null;
        }

        const summary = {
          transcriptPreview: transcript || metadata.transcriptPreview,
          estimatedPlaybackMs: playbackMsForBase64Bytes(totalAudioBytes),
          chunkCount: chunkIndex
        };
        callbacks.onComplete(summary);
        resolve(summary);
      };

      socket = new WebSocket(`${LIVE_URL}?key=${this.apiKey}`);

      socket.on("open", () => {
        logger.info("gemini.live.socket.open", {
          turnId: metadata.turnId,
          model: this.liveModel,
          voice: this.voiceForSpeaker(plan.speaker),
          timeoutMs: this.liveAudioTimeoutMs
        });
        socket?.send(
          JSON.stringify(buildLiveSetupPayload(this.liveModel, this.voiceForSpeaker(plan.speaker), systemInstruction))
        );
      });

      socket.on("message", (raw) => {
        try {
          messageCount += 1;
          const message = JSON.parse(raw.toString()) as LiveServerMessage;
          if (message.error?.message) {
            throw new Error(message.error.message);
          }

          if (message.setupComplete && !setupAcknowledged) {
            setupAcknowledged = true;
            socket?.send(
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
              const mimeType = part.inlineData.mimeType ?? bufferedMimeType ?? "audio/pcm;rate=24000";
              const parsed = parseLiveAudioMimeType(mimeType);
              if (
                parsed.sampleRateHz !== PATHLY_AUDIO_FORMAT.sampleRateHz ||
                parsed.channelCount !== PATHLY_AUDIO_FORMAT.channelCount
              ) {
                throw new Error(`Gemini Live audio must be 24k mono PCM for streaming. Received ${mimeType}.`);
              }
              bufferedMimeType = mimeType;

              if (bufferedChunk !== null) {
                callbacks.onChunk({
                  chunkIndex,
                  audioBase64: bufferedChunk,
                  isFinalChunk: false,
                  transcriptPreview: transcript
                });
                totalAudioBytes += Buffer.byteLength(bufferedChunk, "base64");
                chunkIndex += 1;
              }
              bufferedChunk = part.inlineData.data;
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
          socket?.close();
          const normalized = error instanceof Error ? error : new Error(String(error));
          callbacks.onError(normalized);
          reject(normalized);
        }
      });

      socket.on("error", (error) => {
        clearTimeout(timeout);
        const normalized = error instanceof Error ? error : new Error(String(error));
        logger.warn("gemini.live.socket.error", {
          turnId: metadata.turnId,
          model: this.liveModel,
          message: normalized.message
        });
        callbacks.onError(normalized);
        reject(normalized);
      });

      socket.on("close", (code, reason) => {
        logger.info("gemini.live.socket.closed", {
          turnId: metadata.turnId,
          model: this.liveModel,
          code,
          reason: reason.toString(),
          completed,
          messageCount
        });
        if (!completed) {
          clearTimeout(timeout);
        }
      });
    });

    return {
      cancel() {
        completed = true;
        socket?.close();
      },
      completed: completion
    };
  }
}
