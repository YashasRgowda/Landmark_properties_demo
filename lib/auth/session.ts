import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { SignJWT, jwtVerify } from 'jose';
import type { UserRole } from '@/lib/db/schema';

export const SESSION_COOKIE = 'landmark_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export type SessionPayload = {
  userId: string;
  email: string;
  role: UserRole;
};

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error('AUTH_SECRET is not set.');
  return new TextEncoder().encode(value);
}

export async function encodeSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());
}

export async function decodeSession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] });
    if (typeof payload.userId !== 'string' || typeof payload.email !== 'string') return null;
    return {
      userId: payload.userId,
      email: payload.email,
      role: (payload.role === 'admin' ? 'admin' : 'agent') as UserRole,
    };
  } catch {
    return null;
  }
}

export async function createSessionCookie(payload: SessionPayload): Promise<void> {
  const token = await encodeSession(payload);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

/**
 * The real authorisation check. `proxy.ts` only does an optimistic cookie
 * check; every protected page and route handler calls this.
 */
/**
 * The signed-in user — checked against the database, not just the cookie.
 *
 * The cookie alone stays valid for seven days, so before this a deactivated
 * account, a deleted one, or an admin demoted to agent kept their access until
 * it expired. Now the account must still exist and be active, and the role
 * comes from the database. Cached for the request, so a layout and a page that
 * both ask cost one query.
 */
export const getSession = cache(async (): Promise<SessionPayload | null> => {
  const jar = await cookies();
  const claimed = await decodeSession(jar.get(SESSION_COOKIE)?.value);
  if (!claimed) return null;

  const [user] = await db
    .select({ id: users.id, email: users.email, role: users.role, active: users.active })
    .from(users)
    .where(eq(users.id, claimed.userId))
    .limit(1);
  if (!user || !user.active) return null;

  return { userId: user.id, email: user.email, role: user.role === 'admin' ? 'admin' : 'agent' };
});
