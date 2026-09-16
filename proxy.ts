import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { decodeSession, SESSION_COOKIE } from '@/lib/auth/session';

/**
 * Optimistic gate for /app and /admin. This is a redirect for signed-out
 * visitors, not the authorisation boundary — every protected page and route
 * handler re-checks the session server-side via requireUser()/requireAdmin().
 *
 * (Next 16 renamed `middleware` to `proxy`; the runtime is nodejs.)
 */
export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await decodeSession(token);

  if (!session) {
    const url = new URL('/login', request.url);
    url.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  if (request.nextUrl.pathname.startsWith('/admin') && session.role !== 'admin') {
    return NextResponse.redirect(new URL('/app', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/app/:path*', '/app', '/admin/:path*', '/admin'],
};
