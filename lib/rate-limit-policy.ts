/**
 * Rate limits — the rules. Pure; the counting lives in lib/rate-limit.ts.
 *
 * Fixed windows: every request in the same minute (or quarter hour) shares one
 * counter. Simple, and exact enough to stop a runaway portal integration, a
 * leaked secret being hammered, or a password being guessed.
 */

export type Limit = { name: string; limit: number; windowMs: number };

const MINUTE = 60_000;

export const LIMITS = {
  /** One portal server, however many leads it sends. */
  intakePerIp: { name: 'intake:ip', limit: 60, windowMs: MINUTE },
  /** The same buyer posted over and over — a portal stuck in a retry loop. */
  intakePerPhone: { name: 'intake:phone', limit: 5, windowMs: MINUTE },
  /** Everything together: the ceiling no burst goes over. */
  intakeGlobal: { name: 'intake:all', limit: 300, windowMs: MINUTE },
  /** Password guessing from one address. */
  loginPerIp: { name: 'login:ip', limit: 20, windowMs: 15 * MINUTE },
  /** Password guessing against one account, from anywhere. */
  loginPerEmail: { name: 'login:email', limit: 10, windowMs: 15 * MINUTE },
} satisfies Record<string, Limit>;

/** The start of the window `now` falls in. */
export function windowStart(now: Date, windowMs: number): Date {
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

/** Seconds until the window resets — for a Retry-After header. */
export function retryAfterSeconds(now: Date, windowMs: number): number {
  const end = windowStart(now, windowMs).getTime() + windowMs;
  return Math.max(1, Math.ceil((end - now.getTime()) / 1000));
}

/** The address a request came from. Vercel puts the real one first. */
export function clientIp(forwardedFor: string | null | undefined, realIp?: string | null): string {
  const first = forwardedFor?.split(',')[0]?.trim();
  return first || realIp?.trim() || 'unknown';
}
