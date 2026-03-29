import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import {
  GeneratedAudioMessage,
  PATHLY_AUDIO_FORMAT,
  chunkPcmBuffer,
  createGeneratedAudioMessageFromPcm,
  normalizePcmBuffer,
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

export type StreamedPlaybackCallbacks = {
  onTranscript?: (transcript: string) => void;
  onChunk: (audioBase64: string, isFinalChunk: boolean) => void;
  onComplete?: (transcript: string) => void;
};

type PromptFrame = {
  sessionLayer: string[];
  turnLayer: string[];
  contextLayer: string[];
  behaviorLayer: string[];
};

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

const renderPromptFrame = (frame: PromptFrame) =>
  [
    "Session layer:",
    ...frame.sessionLayer,
    "",
    "Turn layer:",
    ...frame.turnLayer,
    "",
    "Context layer:",
    ...frame.contextLayer,
    "",
    "Behavior layer:",
    ...frame.behaviorLayer
  ].join("\n");

const buildPlaybackPromptFrame = (
  plan: TurnPlan,
  session: RunSession,
  places: PlaceCandidate[],
  news: NewsItem[]
): PromptFrame => ({
  sessionLayer: [
    `You are ${plan.speaker}. The other host is ${plan.otherSpeaker}.`,
    `Host style for this run: ${session.preferences.hostStyle}.`,
    "Treat this as a live two-host exchange, not a standalone monologue."
  ],
  turnLayer: [
    `turnType=${plan.turnType}`,
    `priority=${plan.priority}`,
    `triggerType=${plan.triggerType}`,
    `reason=${plan.reason}`,
    `whyNow=${plan.whyNow}`,
    `targetDurationSeconds=${plan.targetDurationSeconds}`,
    `interrupting=${plan.interrupting ? "true" : "false"}`,
    `supersedesTurnId=${plan.supersedesTurnId ?? "none"}`,
    `recoveryOfTurnId=${plan.recoveryOfTurnId ?? "none"}`
  ],
  contextLayer: [
    `contextSummary=${plan.contextSummary}`,
    `contextDelta=${plan.contextDelta}`,
    `contentBuckets=${plan.contentBuckets.join(", ") || "none"}`,
    `conversationHistory=${plan.conversationHistory.join(" | ") || "none"}`,
    `placeFacts=${places.map((place) => place.fact).join(" | ") || "none"}`,
    `newsCandidates=${news.map((item) => `${item.headline}: ${item.summary}`).join(" | ") || "none"}`,
    `interruptedContext=${plan.interruptedContext ?? "none"}`,
    `interruptedTranscript=${plan.interruptedTranscript ?? "none"}`,
    `interruptingTurnTranscript=${plan.interruptingTurnTranscript ?? "none"}`
  ],
  behaviorLayer: [
    buildDurationGuidance(plan.targetDurationSeconds),
    "Use natural spoken English only. No markdown. No stage directions.",
    "Do not restate what the other host just said unless you are explicitly bridging after an interruption.",
    plan.turnType === "urgent"
      ? "You are jumping in. Start with a very short natural bridge, then give the critical update immediately."
      : plan.turnType === "recovery"
        ? "You were cut off. Choose one: finish the old thought briefly, summarize it in half a sentence and pivot, or drop it and move directly into the newest context. Acknowledge the interruption naturally."
        : "Continue the two-host flow naturally and keep the route context current."
  ]
});

const buildInterruptPromptFrame = (
  session: RunSession,
  intent: string,
  transcriptPreview: string
): PromptFrame => ({
  sessionLayer: [
    "This is a live two-host running conversation, not a standalone voice memo.",
    `Host style: ${session.preferences.hostStyle}.`
  ],
  turnLayer: [
    "turnType=interrupt",
    "priority=p0",
    "triggerType=user_interrupt",
    `intent=${intent}`,
    "whyNow=The runner interrupted the live flow and needs a direct response first."
  ],
  contextLayer: [
    `suggestedResponseDirection=${transcriptPreview}`,
    `conversationHistory=${session.conversationHistory.slice(-4).map((entry) => `${entry.speaker}: ${entry.transcriptPreview}`).join(" | ") || "none"}`
  ],
  behaviorLayer: [
    "Answer directly, keep it brief, and leave a clean handoff back to the live conversation.",
    "Do not add stage directions or markdown."
  ]
});

const buildPlaybackPrompt = (
  plan: TurnPlan,
  session: RunSession,
  places: PlaceCandidate[],
  news: NewsItem[]
) =>
  renderPromptFrame(buildPlaybackPromptFrame(plan, session, places, news));

const buildInterruptPrompt = (session: RunSession, intent: string, transcriptPreview: string) =>
  renderPromptFrame(buildInterruptPromptFrame(session, intent, transcriptPreview));

const updateTranscript = (current: string, next: string | undefined) => {
  const normalized = (next ?? "").trim();
  if (!normalized) {
    return current;
  }
  return normalized.length >= current.length ? normalized : current;
};

const createAbortError = (reason?: unknown) => {
  const message =
    typeof reason === "string" && reason.trim().length > 0
      ? reason
      : "Gemini Live generation was aborted.";
  const error = new Error(message);
  error.name = "AbortError";
  return error;
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
          logger.debug("gemini.live.turn.completed", {
            turnId: metadata.turnId,
            messageCount,
            audioPartCount,
            transcriptLength: (transcript || metadata.transcriptPreview).length
          });
          logger.debug("gemini.live.audio.received", {
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
        logger.debug("gemini.live.socket.open", {
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
            logger.debug("gemini.live.setup.complete", {
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
            logger.debug("gemini.live.prompt.sent", {
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
        const fields = {
          turnId: metadata.turnId,
          model: this.liveModel,
          code,
          reason: reason.toString(),
          completed
        };
        if (!completed) {
          logger.warn("gemini.live.socket.closed", fields);
        } else {
          logger.debug("gemini.live.socket.closed", fields);
        }
        if (!completed) {
          clearTimeout(timeout);
        }
      });
    });
  }

  private async streamLiveAudio<T extends PlaybackSegment | InterruptResult>(
    metadata: T,
    systemInstruction: string,
    userPrompt: string,
    voice: string,
    callbacks: StreamedPlaybackCallbacks,
    signal?: AbortSignal
  ): Promise<void> {
    if (!this.apiKey) {
      throw new Error("Gemini Live is unavailable: missing API key.");
    }

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`${LIVE_URL}?key=${this.apiKey}`);
      let transcript = metadata.transcriptPreview;
      let audioMimeType: string | null = null;
      let completed = false;
      let setupAcknowledged = false;
      let pendingChunk: string | null = null;
      let settled = false;
      let abortListener: (() => void) | null = null;
      let timeout: ReturnType<typeof setTimeout>;

      const cleanup = () => {
        clearTimeout(timeout);
        if (signal && abortListener) {
          signal.removeEventListener("abort", abortListener);
        }
      };

      const settleReject = (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      const settleResolve = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve();
      };

      const emitChunk = (audioBase64: string, isFinalChunk: boolean) => {
        callbacks.onChunk(audioBase64, isFinalChunk);
      };

      const flushPendingFinalChunk = () => {
        if (!pendingChunk) {
          throw new Error("Gemini Live returned no audio parts.");
        }
        emitChunk(pendingChunk, true);
        pendingChunk = null;
      };

      const pushNormalizedChunk = (audioBase64: string) => {
        if (pendingChunk !== null) {
          emitChunk(pendingChunk, false);
        }
        pendingChunk = audioBase64;
      };

      timeout = setTimeout(() => {
        socket.close();
        settleReject(
          new Error(`Gemini Live audio generation timed out after ${this.liveAudioTimeoutMs}ms.`)
        );
      }, this.liveAudioTimeoutMs);

      abortListener = () => {
        socket.close();
        settleReject(createAbortError(signal?.reason));
      };

      if (signal?.aborted) {
        abortListener();
        return;
      }

      signal?.addEventListener("abort", abortListener, { once: true });

      socket.on("open", () => {
        logger.debug("gemini.live.socket.open", {
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
          const message = JSON.parse(raw.toString()) as LiveServerMessage;
          if (message.error?.message) {
            throw new Error(message.error.message);
          }

          if (message.setupComplete && !setupAcknowledged) {
            setupAcknowledged = true;
            logger.debug("gemini.live.setup.complete", {
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
            logger.debug("gemini.live.prompt.sent", {
              turnId: metadata.turnId,
              promptLength: userPrompt.length,
              systemInstructionLength: systemInstruction.length
            });
            return;
          }

          const serverContent = message.serverContent;
          if (!serverContent) {
            return;
          }

          transcript = updateTranscript(transcript, serverContent.outputTranscription?.text);
          callbacks.onTranscript?.(transcript);

          for (const part of serverContent.modelTurn?.parts ?? []) {
            if (part.inlineData?.data) {
              audioMimeType = part.inlineData.mimeType ?? audioMimeType;
              const parsedFormat = parseLiveAudioMimeType(audioMimeType);
              const rawChunk = Buffer.from(part.inlineData.data, "base64");
              const normalizedChunk = normalizePcmBuffer(rawChunk, parsedFormat);
              for (const chunk of chunkPcmBuffer(normalizedChunk)) {
                pushNormalizedChunk(chunk);
              }
            }
            transcript = updateTranscript(transcript, part.text);
            callbacks.onTranscript?.(transcript);
          }

          if (serverContent.interrupted) {
            throw new Error("Gemini Live interrupted the audio turn before completion.");
          }

          if (serverContent.turnComplete) {
            completed = true;
            flushPendingFinalChunk();
            callbacks.onComplete?.(transcript);
            socket.close();
            settleResolve();
          }
        } catch (error) {
          socket.close();
          settleReject(error);
        }
      });

      socket.on("error", (error) => {
        socket.close();
        settleReject(error);
      });

      socket.on("close", (code, reason) => {
        const fields = {
          turnId: metadata.turnId,
          model: this.liveModel,
          code,
          reason: reason.toString(),
          completed
        };
        if (!completed) {
          logger.warn("gemini.live.socket.closed", fields);
        } else {
          logger.debug("gemini.live.socket.closed", fields);
        }
        if (!completed && !settled) {
          if (signal?.aborted) {
            settleReject(createAbortError(signal.reason));
            return;
          }
          settleReject(
            new Error(
              `Gemini Live socket closed before completion (code=${code}, reason=${reason.toString() || "none"}).`
            )
          );
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
      logger.debug("gemini.live.playback.start", {
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
        logger.debug("gemini.live.playback.success", {
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

  async streamPlayback(
    plan: TurnPlan,
    session: RunSession,
    places: PlaceCandidate[],
    news: NewsItem[],
    callbacks: StreamedPlaybackCallbacks,
    signal?: AbortSignal
  ): Promise<void> {
    const metadata: PlaybackSegment = {
      turnId: plan.turnId,
      speaker: plan.speaker,
      segmentType: "main_turn",
      transcriptPreview: `${plan.speaker === "maya" ? "Maya" : "Theo"} is taking the next Pathly turn.`,
      estimatedPlaybackMs: Math.max(1800, plan.targetDurationSeconds * 1000),
      audioFormat: PATHLY_AUDIO_FORMAT
    };

    await this.streamLiveAudio(
      metadata,
      buildSpeakerPersona(plan.speaker, session.preferences.hostStyle),
      buildPlaybackPrompt(plan, session, places, news),
      this.voiceForSpeaker(plan.speaker),
      callbacks,
      signal
    );
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
      intent,
      transcriptPreview,
      estimatedPlaybackMs: Math.max(1400, transcriptPreview.length * 90),
      audioFormat: PATHLY_AUDIO_FORMAT
    };

    try {
      logger.debug("gemini.live.interrupt.start", {
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
        logger.debug("gemini.live.interrupt.success", {
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

  async streamInterruptResult(
    metadata: InterruptResult,
    session: RunSession,
    intent: string,
    transcriptPreview: string,
    callbacks: StreamedPlaybackCallbacks,
    signal?: AbortSignal
  ): Promise<void> {
    await this.streamLiveAudio(
      metadata,
      buildSpeakerPersona(metadata.speaker, session.preferences.hostStyle),
      buildInterruptPrompt(session, intent, transcriptPreview),
      this.voiceForSpeaker(metadata.speaker),
      callbacks,
      signal
    );
  }
}
