export class HttpError extends Error {
  constructor(message: string, readonly status?: number) {
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
