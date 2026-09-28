/**
 * The one-minute timer: Supabase calls the live worker every minute, so jobs
 * scheduled for later — the 2-minute delivery check, a call due in 10 minutes,
 * visit reminders, chase steps — actually run. Without it the system only wakes
 * when a message arrives, and a buyer who never replies is never followed up.
 *
 *   npm run scheduler:setup                      # create or update the timer
 *   npm run scheduler:setup -- --remove          # turn it off
 *   npm run scheduler:setup -- --status          # show it and its recent runs
 *
 * Uses pg_cron (the timer) and pg_net (the HTTP call), both built into
 * Supabase. The worker URL and CRON_SECRET come from .env.local.
 */
import postgres from 'postgres';

const JOB = 'landmark-worker-every-minute';
/** The timer logs every run — 1,440 rows a day. This keeps a week of them. */
const CLEANUP = 'landmark-timer-log-cleanup';
const URL_ = process.env.WORKER_URL?.trim() || 'https://landmark-properties-demo.vercel.app/api/cron/worker';

async function main() {
  const mode = process.argv.includes('--remove') ? 'remove' : process.argv.includes('--status') ? 'status' : 'setup';
  const secret = process.env.CRON_SECRET?.trim();
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  if (mode === 'setup' && !secret) throw new Error('CRON_SECRET is not set.');

  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
  try {
    if (mode === 'remove') {
      const [row] = await sql`select jobid from cron.job where jobname = ${JOB}`;
      if (row) await sql`select cron.unschedule(${JOB})`;
      const [tidy] = await sql`select jobid from cron.job where jobname = ${CLEANUP}`;
      if (tidy) await sql`select cron.unschedule(${CLEANUP})`;
      console.log(row ? 'Timer removed.' : 'No timer was set.');
      return;
    }

    if (mode === 'setup') {
      await sql.unsafe('create extension if not exists pg_cron with schema pg_catalog');
      await sql.unsafe('create extension if not exists pg_net with schema extensions');

      // The worker may run for up to ~55s; give the call a full minute so the
      // connection is not dropped while it works.
      const command = `select net.http_get(
        url := ${literal(URL_)},
        headers := jsonb_build_object('x-cron-secret', ${literal(secret!)}),
        timeout_milliseconds := 60000
      );`;

      const [existing] = await sql`select jobid from cron.job where jobname = ${JOB}`;
      if (existing) await sql`select cron.unschedule(${JOB})`;
      await sql`select cron.schedule(${JOB}, '* * * * *', ${command})`;
      console.log(`${existing ? 'Updated' : 'Created'} the timer: every minute → ${URL_}`);

      const [tidy] = await sql`select jobid from cron.job where jobname = ${CLEANUP}`;
      if (tidy) await sql`select cron.unschedule(${CLEANUP})`;
      await sql`select cron.schedule(${CLEANUP}, '30 3 * * *',
        $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$)`;
      console.log('Daily clean-up of the timer log: 03:30 UTC, keeps 7 days');
    }

    const [job] = await sql`select jobid, schedule, active from cron.job where jobname = ${JOB}`;
    if (!job) { console.log('No timer is set.'); return; }
    console.log(`Timer: ${job.active ? 'ON' : 'OFF'} · schedule "${job.schedule}"`);
    const runs = await sql`select status, start_time, return_message from cron.job_run_details
      where jobid = ${job.jobid} order by start_time desc limit 5`;
    for (const r of runs) console.log(`  ${r.start_time.toISOString()}  ${r.status}  ${String(r.return_message ?? '').slice(0, 60)}`);
    if (runs.length === 0) console.log('  (no runs yet — the first is within a minute)');
  } finally {
    await sql.end();
  }
}

/** A SQL string literal. Values here come from our own .env.local, not users. */
function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
