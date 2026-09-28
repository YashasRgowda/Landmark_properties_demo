import { NextResponse } from 'next/server';
import { extractSecret, secretMatches } from '@/lib/security/secret';

/**
 * POST /api/dev/break-ai                   — point the AI at a dead endpoint
 * POST /api/dev/break-ai?restore=1         — put it back
 * POST /api/dev/break-ai?base=<local url>  — point it at a scripted fake, so a
 *                                            test can make the AI slow, hang or
 *                                            refuse on demand
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

  const params = new URL(request.url).searchParams;
  const base = params.get('base');

  if (base) {
    // Local addresses only: this must never be a way to send prompts elsewhere.
    let host: string;
    try {
      host = new URL(base).hostname;
    } catch {
      return NextResponse.json({ ok: false, error: 'base is not a URL' }, { status: 400 });
    }
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
      return NextResponse.json({ ok: false, error: 'base must be local' }, { status: 400 });
    }
    process.env.GEMINI_API_BASE = base;
  } else {
    process.env.GEMINI_API_BASE = params.get('restore') === '1' ? REAL : DEAD;
  }

  return NextResponse.json({ ok: true, base: process.env.GEMINI_API_BASE });
}
