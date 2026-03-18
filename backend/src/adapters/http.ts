import { HttpError } from "../errors.js";

export const requireOk = async (response: Response, label: string) => {
  if (response.ok) {
    return response;
  }

  const body = await response.text();
  let providerError:
    | {
        status?: string;
        message?: string;
        details?: unknown;
        rawBody?: string;
      }
    | undefined;

  try {
    const parsed = JSON.parse(body) as {
      error?: {
        status?: string;
        message?: string;
        details?: unknown;
      };
    };
    providerError = {
      status: parsed.error?.status,
      message: parsed.error?.message,
      details: parsed.error?.details,
      rawBody: body
    };
  } catch {
    providerError = {
      rawBody: body
    };
  }

  throw new HttpError(`${label} failed: ${response.status} ${body}`, response.status, providerError);
};
