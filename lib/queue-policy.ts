/**
 * Retry policy for the task queue. Pure, with no database or server imports,
 * so the rules can be unit-tested on their own.
 */

/** Give up after this many attempts. An attempt is counted when it is claimed. */
export const MAX_ATTEMPTS = 5;

/** Wait before retry number N. Capped at the last value. */
export const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000] as const;

/**
 * A task claimed but never finished — the worker process died mid-run — is
 * returned to PENDING after this long, so a crash can never strand a lead.
 */
export const STUCK_AFTER_MS = 10 * 60_000;

/**
 * How long to wait before retrying, given how many attempts have already been
 * made. `attempts` is 1 after the first run.
 */
export function backoffMs(attempts: number): number {
  if (attempts < 1) return BACKOFF_MS[0];
  return BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1];
}
