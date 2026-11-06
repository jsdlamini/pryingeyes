export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string, public extra?: Record<string, unknown>) {
    super(message ?? code);
  }
}
export const badRequest = (code: string, msg?: string) => new HttpError(400, code, msg);
export const unauthorized = (code = "signin_required", msg = "Please sign in.") => new HttpError(401, code, msg);
export const forbidden = (code = "forbidden", msg = "You can't do that.") => new HttpError(403, code, msg);
export const notFound = (code = "not_found", msg = "Not found.") => new HttpError(404, code, msg);
export const conflict = (code: string, msg?: string) => new HttpError(409, code, msg);
export const tooMany = (retryAfter: number, msg = "Too many attempts. Please try again later.") =>
  new HttpError(429, "rate_limited", msg, { retryAfter });
