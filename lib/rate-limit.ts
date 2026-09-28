import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { rateLimits } from '@/lib/db/schema';
import { retryAfterSeconds, windowStart, type Limit } from './rate-limit-policy';

export type RateResult = { allowed: true } | { allowed: false; retryAfter: number; limit: string };

/**
 * Count one request against a limit, and say whether it is allowed.
 *
 * One atomic upsert per check, so two server instances counting at the same
 * moment cannot both slip under the limit. If the database cannot be reached
 * the request is allowed: a limiter must never be the reason a real buyer's
 * enquiry is lost.
 */
export async function hit(limit: Limit, subject: string, now = new Date()): Promise<RateResult> {
  const key = `${limit.name}:${subject}`.slice(0, 200);
  const window = windowStart(now, limit.windowMs);
  try {
    const [row] = await db
      .insert(rateLimits)
      .values({ key, windowStart: window, hits: 1 })
      .onConflictDoUpdate({
        target: [rateLimits.key, rateLimits.windowStart],
        set: { hits: sql`${rateLimits.hits} + 1` },
      })
      .returning({ hits: rateLimits.hits });

    return row.hits <= limit.limit
      ? { allowed: true }
      : { allowed: false, retryAfter: retryAfterSeconds(now, limit.windowMs), limit: limit.name };
  } catch (error) {
    console.error('[rate-limit] could not count; allowing the request', error);
    return { allowed: true };
  }
}

/** Check several limits; the first one exceeded wins. All are counted. */
export async function hitAll(checks: [Limit, string][], now = new Date()): Promise<RateResult> {
  const results = await Promise.all(checks.map(([l, s]) => hit(l, s, now)));
  return results.find((r) => !r.allowed) ?? { allowed: true };
}

/** Old windows are useless after a day. Called from the timer. */
export async function pruneRateLimits(): Promise<void> {
  await db.execute(sql`delete from rate_limits where window_start < now() - interval '1 day'`);
}
