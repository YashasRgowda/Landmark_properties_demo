import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time secret comparison. Both sides are hashed first so the
 * comparison length never depends on the attacker's input.
 */
export function secretMatches(provided: string | null | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Reads a shared secret from the request.
 *
 * `Authorization: Bearer <secret>` is always accepted — it is what Vercel Cron
 * sends. `headerNames` lists the plain headers this particular endpoint also
 * accepts, so the lead webhook and the cron worker each name their own.
 */
export function extractSecret(headers: Headers, headerNames: string[] = ['x-webhook-secret']): string | null {
  const auth = headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();

  for (const name of headerNames) {
    const value = headers.get(name);
    if (value) return value.trim();
  }
  return null;
}
