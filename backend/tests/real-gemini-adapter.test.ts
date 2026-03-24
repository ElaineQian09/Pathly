import { describe, expect, it } from "vitest";
import { buildLiveSetupPayload } from "../src/adapters/real-gemini-adapter.js";

describe("buildLiveSetupPayload", () => {
  it("nests speechConfig under generationConfig for Gemini Live WebSocket setup", () => {
    const payload = buildLiveSetupPayload(
      "gemini-2.5-flash-native-audio-preview-12-2025",
      "Kore",
      "Speak briefly."
    );

    expect(payload).toEqual({
      setup: {
        model: "models/gemini-2.5-flash-native-audio-preview-12-2025",
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Kore"
              }
            }
          }
        },
        systemInstruction: {
          parts: [{ text: "Speak briefly." }]
        },
        outputAudioTranscription: {}
      }
    });
    expect(payload.setup).not.toHaveProperty("speechConfig");
  });
});
