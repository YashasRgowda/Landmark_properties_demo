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

/** Reads the shared secret from either header style a portal might send. */
export function extractSecret(headers: Headers): string | null {
  const auth = headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return headers.get('x-webhook-secret');
}
