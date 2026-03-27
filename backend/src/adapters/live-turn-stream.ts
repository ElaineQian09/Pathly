import type { AudioSegmentMetadata } from "../models/types.js";

export type TurnStreamChunk = {
  chunkIndex: number;
  audioBase64: string;
  isFinalChunk: boolean;
  transcriptPreview?: string;
};

export type TurnStreamCompletion = {
  transcriptPreview: string;
  estimatedPlaybackMs: number;
  chunkCount: number;
};

export type TurnStreamCallbacks<T extends AudioSegmentMetadata> = {
  onSegmentReady(metadata: T): void;
  onChunk(chunk: TurnStreamChunk): void;
  onComplete(summary: TurnStreamCompletion): void;
  onError(error: Error): void;
};

export type TurnStreamHandle = {
  cancel(): void;
  completed: Promise<TurnStreamCompletion>;
};
