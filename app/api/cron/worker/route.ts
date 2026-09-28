import { NextResponse } from 'next/server';
import { runDueTasks } from '@/lib/tasks/runner';
import { sweepChases, type SweepReport } from '@/lib/chase-engine';
import { queueEnv } from '@/lib/queue-policy';
import { checkLeadDrought } from '@/lib/lead-drought-check';
import { pruneRateLimits } from '@/lib/rate-limit';
import type { Drought } from '@/lib/lead-drought';
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

/** Reserved for tests and simulators; never followed up in production. */
const TEST_PHONE_PREFIX = '91900000';

export async function GET(request: Request) {
  if (!secretMatches(extractSecret(request.headers, ['x-cron-secret']), process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: 'unauthorised' }, { status: 401 });
  }

  // Find buyers who have gone quiet and start their follow-ups. Production
  // only: the local database is shared, and a laptop must never start a
  // sequence for a real buyer. Test numbers are never swept in production.
  let sweep: SweepReport | { error: string } | null = null;
  if (queueEnv() === 'production') {
    try {
      sweep = await sweepChases({ excludePhonePrefix: TEST_PHONE_PREFIX });
    } catch (error) {
      console.error('[cron/worker] sweep failed', error);
      sweep = { error: error instanceof Error ? error.message : String(error) };
    }
  }

  // No leads for two office hours usually means a portal feed has broken.
  // Logged at most twice an hour — the Today screen shows it all the time.
  let drought: Drought = null;
  if (queueEnv() === 'production') {
    try {
      drought = await checkLeadDrought();
      if (drought && new Date().getUTCMinutes() % 30 === 0) {
        console.warn(`[ALERT] ${drought.message} (${drought.quietOfficeMinutes} office minutes)`);
      }
    } catch (error) {
      console.error('[cron/worker] drought check failed', error);
    }
  }

  // Old rate-limit counts are useless after a day. Cheap, and never fatal.
  await pruneRateLimits().catch((error) => console.error('[cron/worker] prune failed', error));

  try {
    const report = await runDueTasks(50);
    return NextResponse.json({ ok: true, ...report, sweep, drought });
  } catch (error) {
    console.error('[cron/worker] run failed', error);
    return NextResponse.json({ ok: false, error: 'worker run failed' }, { status: 500 });
  }
}
