import { NextResponse } from 'next/server';
import { extractSecret, secretMatches } from '@/lib/security/secret';
import { sweepChases } from '@/lib/chase-engine';

/**
 * POST /api/dev/sweep-chases?prefix=9190000004[&now=<ISO time>]
 *
 * Development only. Runs the quiet-buyer sweep on test numbers alone — the
 * prefix is required, so it can never reach a real lead — optionally as if it
 * were a later time, so a two-day silence can be tested in a second.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  if (!secretMatches(extractSecret(request.headers, ['x-cron-secret']), process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: 'unauthorised' }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const dryRun = params.get('dryRun') === '1';
  const prefix = params.get('prefix')?.trim();
  // A dry run only reads, so it may look at every lead — that is how you see,
  // before shipping, exactly who production would follow up. Anything that
  // starts a sequence is kept to test numbers.
  if (!dryRun && (!prefix || !/^9190000/.test(prefix))) {
    return NextResponse.json({ ok: false, error: 'prefix must be a reserved test number range' }, { status: 400 });
  }
  const nowParam = params.get('now');
  const now = nowParam ? new Date(nowParam) : new Date();
  if (Number.isNaN(now.getTime())) {
    return NextResponse.json({ ok: false, error: 'now is not a date' }, { status: 400 });
  }

  const report = await sweepChases(dryRun
    ? { dryRun: true, now, excludePhonePrefix: '91900000' }
    : { onlyPhonePrefix: prefix!, now });
  return NextResponse.json({ ok: true, ...report });
}
