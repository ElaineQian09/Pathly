export class HttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly providerError?: {
      status?: string;
      message?: string;
      details?: unknown;
      rawBody?: string;
    }
  ) {
    super(message);
  }
}

export class NoRouteCandidatesError extends Error {
  constructor(
    message: string,
    readonly failures: string[]
  ) {
    super(message);
  }
}
