import 'server-only';
import { redirect } from 'next/navigation';
import { getSession, type SessionPayload } from './session';

/** Use at the top of every protected page and layout. Redirects if signed out. */
export async function requireUser(returnTo?: string): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) {
    const next = returnTo ? `?next=${encodeURIComponent(returnTo)}` : '';
    redirect(`/login${next}`);
  }
  return session;
}

/** Admin-only pages. An agent hitting /admin is sent back to /app. */
export async function requireAdmin(returnTo?: string): Promise<SessionPayload> {
  const session = await requireUser(returnTo);
  if (session.role !== 'admin') redirect('/app');
  return session;
}
