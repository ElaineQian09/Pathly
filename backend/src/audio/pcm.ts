import fs from "node:fs";
import path from "node:path";
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
const DEBUG_AUDIO_DIR = process.env.PATHLY_DEBUG_AUDIO_DIR ?? null;

export const PATHLY_AUDIO_FORMAT = {
  encoding: "pcm_s16le" as const,
  sampleRateHz: 24000 as const,
  channelCount: 1 as const
};

export type PcmAudioFormat = {
  encoding: "pcm_s16le";
  sampleRateHz: number;
  channelCount: number;
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

const playbackMsForBuffer = (buffer: Buffer) =>
  Math.round((buffer.length / (SAMPLE_RATE_HZ * CHANNEL_COUNT * BYTES_PER_SAMPLE)) * 1000);

const wavHeaderFor = (pcmByteLength: number) => {
  const blockAlign = CHANNEL_COUNT * BYTES_PER_SAMPLE;
  const byteRate = SAMPLE_RATE_HZ * blockAlign;
  const buffer = Buffer.alloc(44);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + pcmByteLength, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(CHANNEL_COUNT, 22);
  buffer.writeUInt32LE(SAMPLE_RATE_HZ, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(pcmByteLength, 40);
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

export const parseLiveAudioMimeType = (mimeType: string | null | undefined): PcmAudioFormat => {
  if (!mimeType) {
    return PATHLY_AUDIO_FORMAT;
  }

  const normalized = mimeType.toLowerCase();
  if (!normalized.startsWith("audio/pcm")) {
    throw new Error(`Unsupported Gemini Live audio mimeType: ${mimeType}`);
  }
  if (
    normalized.includes("riff") ||
    normalized.includes("wav") ||
    normalized.includes("ogg") ||
    normalized.includes("aac") ||
    normalized.includes("opus") ||
    normalized.includes("mp3")
  ) {
    throw new Error(`Gemini Live audio mimeType is not raw PCM: ${mimeType}`);
  }
  if (normalized.includes("float") || normalized.includes("f32") || normalized.includes("unsigned") || normalized.includes("big-endian")) {
    throw new Error(`Unsupported Gemini Live PCM subtype: ${mimeType}`);
  }

  const rateMatch = normalized.match(/rate=(\d+)/);
  const channelsMatch = normalized.match(/(?:channels|channelcount)=(\d+)/);
  return {
    encoding: "pcm_s16le",
    sampleRateHz: rateMatch ? Number(rateMatch[1]) : 24000,
    channelCount: channelsMatch ? Number(channelsMatch[1]) : 1
  };
};

const downmixToMono = (buffer: Buffer, channelCount: number) => {
  if (channelCount === 1) {
    return buffer;
  }

  const sampleFrameCount = Math.floor(buffer.length / (BYTES_PER_SAMPLE * channelCount));
  const mono = Buffer.alloc(sampleFrameCount * BYTES_PER_SAMPLE);
  for (let frameIndex = 0; frameIndex < sampleFrameCount; frameIndex += 1) {
    let total = 0;
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const offset = (frameIndex * channelCount + channelIndex) * BYTES_PER_SAMPLE;
      total += buffer.readInt16LE(offset);
    }
    mono.writeInt16LE(clamp16(total / channelCount), frameIndex * BYTES_PER_SAMPLE);
  }
  return mono;
};

const resampleTo24k = (buffer: Buffer, inputSampleRate: number) => {
  if (inputSampleRate === SAMPLE_RATE_HZ) {
    return buffer;
  }

  const inputSampleCount = buffer.length / BYTES_PER_SAMPLE;
  const outputSampleCount = Math.max(1, Math.round((inputSampleCount * SAMPLE_RATE_HZ) / inputSampleRate));
  const output = Buffer.alloc(outputSampleCount * BYTES_PER_SAMPLE);
  for (let outputIndex = 0; outputIndex < outputSampleCount; outputIndex += 1) {
    const sourcePosition = (outputIndex * inputSampleRate) / SAMPLE_RATE_HZ;
    const leftIndex = Math.floor(sourcePosition);
    const rightIndex = Math.min(inputSampleCount - 1, leftIndex + 1);
    const mix = sourcePosition - leftIndex;
    const leftSample = buffer.readInt16LE(Math.min(leftIndex, inputSampleCount - 1) * BYTES_PER_SAMPLE);
    const rightSample = buffer.readInt16LE(rightIndex * BYTES_PER_SAMPLE);
    output.writeInt16LE(clamp16(leftSample + (rightSample - leftSample) * mix), outputIndex * BYTES_PER_SAMPLE);
  }
  return output;
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

const assertChunkRoundTrip = (source: Buffer, chunks: string[]) => {
  const rebuilt = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk, "base64")));
  if (!rebuilt.equals(source)) {
    throw new Error("PCM chunk base64 round-trip mismatch.");
  }
};

const maybeDumpDebugWav = (turnId: string, pcmBuffer: Buffer) => {
  if (!DEBUG_AUDIO_DIR) {
    return;
  }

  fs.mkdirSync(DEBUG_AUDIO_DIR, { recursive: true });
  const outputPath = path.join(DEBUG_AUDIO_DIR, `${turnId}.wav`);
  fs.writeFileSync(outputPath, Buffer.concat([wavHeaderFor(pcmBuffer.length), pcmBuffer]));
};

export const createGeneratedAudioMessageFromPcm = <T extends AudioMetadata>(
  metadata: T,
  pcmBuffer: Buffer,
  inputFormat: PcmAudioFormat
): GeneratedAudioMessage<T> => {
  if (inputFormat.channelCount < 1) {
    throw new Error(`Invalid PCM channel count: ${inputFormat.channelCount}`);
  }
  if (inputFormat.sampleRateHz < 1000) {
    throw new Error(`Invalid PCM sample rate: ${inputFormat.sampleRateHz}`);
  }

  let normalizedBuffer = downmixToMono(pcmBuffer, inputFormat.channelCount);
  normalizedBuffer = resampleTo24k(normalizedBuffer, inputFormat.sampleRateHz);
  assertPathlyPcm(normalizedBuffer);
  const actualPlaybackMs = playbackMsForBuffer(normalizedBuffer);
  const audioChunks = chunkBuffer(normalizedBuffer);
  assertChunkRoundTrip(normalizedBuffer, audioChunks);
  maybeDumpDebugWav(metadata.turnId, normalizedBuffer);

  return {
    ...metadata,
    audioFormat: PATHLY_AUDIO_FORMAT,
    estimatedPlaybackMs: actualPlaybackMs,
    audioChunks
  } as unknown as GeneratedAudioMessage<T>;
};

export const createGeneratedAudioMessage = <T extends AudioMetadata>(
  metadata: T
): GeneratedAudioMessage<T> => {
  const pcmBuffer = buildPcmBuffer(metadata.transcriptPreview, metadata.estimatedPlaybackMs);
  return createGeneratedAudioMessageFromPcm(metadata, pcmBuffer, PATHLY_AUDIO_FORMAT);
};
