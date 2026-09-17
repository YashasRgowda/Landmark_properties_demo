import { NextResponse } from 'next/server';
import { runDueTasks } from '@/lib/tasks/runner';
import { extractSecret, secretMatches } from '@/lib/security/secret';

/**
 * GET /api/cron/worker
 *
 * Runs every due task. Called on a schedule (Vercel Cron sends
 * `Authorization: Bearer <CRON_SECRET>`), or by hand with:
 *   x-cron-secret: <CRON_SECRET>
 *
 * The secret never goes in the query string — URLs end up in server logs.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!secretMatches(extractSecret(request.headers, ['x-cron-secret']), process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: 'unauthorised' }, { status: 401 });
  }

  try {
    const report = await runDueTasks(50);
    return NextResponse.json({ ok: true, ...report });
  } catch (error) {
    console.error('[cron/worker] run failed', error);
    return NextResponse.json({ ok: false, error: 'worker run failed' }, { status: 500 });
  }
}
