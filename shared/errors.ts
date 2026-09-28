/** Errors with a stable machine code and HTTP status. Messages are user-safe. */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what = "Resource") => new AppError("NOT_FOUND", `${what} not found`, 404);
export const forbidden = (msg = "Forbidden") => new AppError("FORBIDDEN", msg, 403);
export const unauthorized = (msg = "Authentication required") => new AppError("UNAUTHORIZED", msg, 401);
export const conflict = (msg: string) => new AppError("CONFLICT", msg, 409);
export const badRequest = (msg: string, details?: Record<string, unknown>) =>
  new AppError("BAD_REQUEST", msg, 400, details);
export const tooManyRequests = (msg = "Too many requests", retryAfterSec?: number) =>
  new AppError("RATE_LIMITED", msg, 429, retryAfterSec ? { retryAfterSec } : undefined);

/** Errors thrown by agents / workflow steps. `retryable` drives job backoff. */
export class AutomationError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly code = "AUTOMATION_ERROR",
  ) {
    super(message);
    this.name = "AutomationError";
  }
}
