/**
 * Retry policy for the task queue. Pure, with no database or server imports,
 * so the rules can be unit-tested on their own.
 */

/** Give up after this many attempts. An attempt is counted when it is claimed. */
export const MAX_ATTEMPTS = 5;

/** Wait before retry number N. Capped at the last value. */
export const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000] as const;

/**
 * The longest a single task may run. Kept well inside the hosting platform's
 * 60-second limit: a task the platform kills leaves no error and no retry
 * behind — just a buyer waiting.
 */
export const TASK_TIMEOUT_MS = 40_000;

/**
 * A task claimed but never finished — the process was killed mid-run — goes
 * back to PENDING after this long.
 *
 * It was 10 minutes. On the first live demo that was exactly how long a
 * buyer's "hi" sat unanswered after the platform cut the worker off. Anything
 * still RUNNING past the task timeout plus a margin is certainly dead.
 */
export const STUCK_AFTER_MS = TASK_TIMEOUT_MS + 50_000;

/**
 * Which deployment a task belongs to.
 *
 * Local development and production share one database, and so one queue. Left
 * unscoped, a laptop running the chat simulator claims a REAL buyer's reply,
 * "sends" it to the local fake WhatsApp server, and marks it done — the buyer
 * gets silence and nothing anywhere shows an error. Each environment now only
 * ever runs the work it created.
 */
export function queueEnv(): string {
  return process.env.VERCEL_ENV?.trim() || 'local';
}

/**
 * Work the buyer is waiting on goes first. Before this, the worker took the
 * oldest task first, so a slow background scoring job queued earlier could use
 * up the whole time budget and a reply behind it never ran at all.
 */
export const TASK_PRIORITY: Record<string, number> = {
  PROCESS_WA_EVENT: 0,    // a buyer just messaged
  SEND_FIRST_MESSAGE: 0,  // a new lead is waiting for our first WhatsApp
  SEND_VISIT_REMINDER: 1,
  CHECK_DELIVERY: 1,
  ESCALATE_TO_AGENT: 1,
  CREATE_CALL_TASK: 1,
  SEND_CHASE_MESSAGE: 2,
  ADVANCE_CHASE: 2,
  RUN_READER: 3,          // scoring: important, but never ahead of a reply
  DEV_ECHO: 4,
};

/**
 * How long to wait before retrying, given how many attempts have already been
 * made. `attempts` is 1 after the first run.
 */
export function backoffMs(attempts: number): number {
  if (attempts < 1) return BACKOFF_MS[0];
  return BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1];
}
