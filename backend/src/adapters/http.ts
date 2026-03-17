import { HttpError } from "../errors.js";

export const requireOk = async (response: Response, label: string) => {
  if (response.ok) {
    return response;
  }

  const body = await response.text();
  throw new HttpError(`${label} failed: ${response.status} ${body}`, response.status);
};
