/**
 * Monitoring cadence (spec §13): day 1, 3, 7, 14, 30 after removal, then every
 * `intervalDays` (user-configurable, default 30).
 */
export const RECHECK_SCHEDULE_DAYS = [1, 3, 7, 14, 30] as const;

export function nextRecheck(from: Date, step: number, intervalDays = 30): { at: Date; step: number } {
  const days =
    step < RECHECK_SCHEDULE_DAYS.length
      ? RECHECK_SCHEDULE_DAYS[step]! - (step === 0 ? 0 : RECHECK_SCHEDULE_DAYS[step - 1]!)
      : intervalDays;
  return { at: new Date(from.getTime() + days * 86_400_000), step: step + 1 };
}

/** Exponential backoff with full jitter for retries (ms). */
export function backoffMs(attempt: number, baseMs = 30_000, maxMs = 6 * 3600_000): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.floor(exp / 2 + Math.random() * (exp / 2));
}
