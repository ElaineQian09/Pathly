export class HttpError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export const requireOk = async (response: Response, label: string) => {
  if (response.ok) {
    return response;
  }

  const body = await response.text();
  throw new HttpError(`${label} failed: ${response.status} ${body}`, response.status);
};
