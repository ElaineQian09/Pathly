import type { InterruptResult, PlaybackFiller, PlaybackSegment } from "../models/types.js";

const SAMPLE_RATE_HZ = 24000;
const CHANNEL_COUNT = 1;
const BYTES_PER_SAMPLE = 2;
const DEFAULT_CHUNK_MS = 1200;
const RIFF_HEADER = Buffer.from("RIFF");
const OGG_HEADER = Buffer.from("OggS");
const ID3_HEADER = Buffer.from("ID3");

const hasPrefix = (buffer: Buffer, prefix: Buffer) =>
  buffer.length >= prefix.length && buffer.subarray(0, prefix.length).equals(prefix);

export const PATHLY_AUDIO_FORMAT = {
  encoding: "pcm_s16le" as const,
  sampleRateHz: 24000 as const,
  channelCount: 1 as const
};

type AudioMetadata = PlaybackSegment | PlaybackFiller | InterruptResult;

export type GeneratedAudioMessage<T extends AudioMetadata = AudioMetadata> = T & {
  audioChunks: string[];
};

const clamp16 = (value: number) => Math.max(-32768, Math.min(32767, Math.round(value)));

const charFrequency = (character: string) => {
  const code = character.charCodeAt(0);
  return 170 + (code % 19) * 18;
};

const envelope = (position: number) => {
  if (position < 0.1) {
    return position / 0.1;
  }
  if (position > 0.82) {
    return Math.max(0, 1 - (position - 0.82) / 0.18);
  }
  return 1;
};

const synthesizeFrame = (character: string, durationMs: number) => {
  const sampleCount = Math.max(1, Math.round((durationMs / 1000) * SAMPLE_RATE_HZ));
  const frame = new Int16Array(sampleCount);
  if (character === " ") {
    return frame;
  }

  const fundamental = charFrequency(character);
  const harmonic = fundamental * 2.02;
  const shimmer = fundamental * 3.01;
  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / SAMPLE_RATE_HZ;
    const shape = envelope(index / sampleCount);
    const sample =
      Math.sin(2 * Math.PI * fundamental * time) * 0.56 +
      Math.sin(2 * Math.PI * harmonic * time) * 0.22 +
      Math.sin(2 * Math.PI * shimmer * time) * 0.08;
    frame[index] = clamp16(sample * shape * 14000);
  }
  return frame;
};

const buildPcmBuffer = (transcriptPreview: string, estimatedPlaybackMs: number) => {
  const text = transcriptPreview.trim() || "Pathly keeps the run moving.";
  const characters = text.slice(0, 220).split("");
  const targetMs = Math.max(estimatedPlaybackMs, 1200);
  const perCharMs = Math.max(28, Math.min(72, Math.floor(targetMs / Math.max(characters.length, 1))));
  const frames = characters.map((character) => synthesizeFrame(character, perCharMs));
  const totalSamples = frames.reduce((sum, frame) => sum + frame.length, 0);
  const buffer = Buffer.alloc(totalSamples * BYTES_PER_SAMPLE);
  let offset = 0;
  for (const frame of frames) {
    for (let index = 0; index < frame.length; index += 1) {
      buffer.writeInt16LE(frame[index], offset);
      offset += BYTES_PER_SAMPLE;
    }
  }
  return buffer;
};

const assertPathlyPcm = (buffer: Buffer) => {
  if (buffer.length === 0 || buffer.length % BYTES_PER_SAMPLE !== 0) {
    throw new Error("Generated audio is not aligned to pcm_s16le sample boundaries.");
  }

  if (hasPrefix(buffer, RIFF_HEADER) || hasPrefix(buffer, OGG_HEADER) || hasPrefix(buffer, ID3_HEADER)) {
    throw new Error("Generated audio must be raw pcm_s16le, not a container or compressed stream.");
  }
};

const chunkBuffer = (buffer: Buffer, chunkMs = DEFAULT_CHUNK_MS) => {
  const chunkByteLength = Math.max(
    BYTES_PER_SAMPLE,
    Math.round((chunkMs / 1000) * SAMPLE_RATE_HZ * CHANNEL_COUNT * BYTES_PER_SAMPLE)
  );
  const chunks: string[] = [];
  for (let offset = 0; offset < buffer.length; offset += chunkByteLength) {
    chunks.push(buffer.subarray(offset, offset + chunkByteLength).toString("base64"));
  }
  return chunks.length > 0 ? chunks : [Buffer.alloc(BYTES_PER_SAMPLE).toString("base64")];
};

export const createGeneratedAudioMessage = <T extends AudioMetadata>(
  metadata: T
): GeneratedAudioMessage<T> => {
  const pcmBuffer = buildPcmBuffer(metadata.transcriptPreview, metadata.estimatedPlaybackMs);
  assertPathlyPcm(pcmBuffer);
  return {
    ...metadata,
    audioChunks: chunkBuffer(pcmBuffer)
  } as GeneratedAudioMessage<T>;
};
