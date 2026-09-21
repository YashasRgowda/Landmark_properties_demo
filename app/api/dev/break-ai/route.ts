import { NextResponse } from 'next/server';
import { extractSecret, secretMatches } from '@/lib/security/secret';

/**
 * POST /api/dev/break-ai        — point the AI at a dead endpoint
 * POST /api/dev/break-ai?restore=1 — put it back
 *
 * Development only. Used to prove the buyer still gets an answer when the AI is
 * unreachable (golden rule 6).
 */
export const dynamic = 'force-dynamic';

const REAL = 'https://generativelanguage.googleapis.com/v1beta';
const DEAD = 'http://127.0.0.1:9/dead';

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  if (!secretMatches(extractSecret(request.headers, ['x-cron-secret']), process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: 'unauthorised' }, { status: 401 });
  }

  const restore = new URL(request.url).searchParams.get('restore') === '1';
  process.env.GEMINI_API_BASE = restore ? REAL : DEAD;

  return NextResponse.json({ ok: true, base: process.env.GEMINI_API_BASE });
}
