/**
 * Phase 2 acceptance test — the task queue.
 *
 *   npm run verify:phase2
 *
 * Requires the dev server running (npm run dev). Only touches DEV_ECHO tasks,
 * which it deletes afterwards, so it is safe to run against real data.
 */
import postgres from 'postgres';

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000';
const KEY_PREFIX = 'verify-phase2-';

let passed = 0;
let failed = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(
    `  ${ok ? '✓' : '✗'} ${label}` +
      (ok ? '' : `  — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`),
  );
  if (ok) passed++;
  else failed++;
}

async function worker(secret: string | null = process.env.CRON_SECRET ?? null) {
  const res = await fetch(`${BASE}/api/cron/worker`, {
    headers: secret ? { 'x-cron-secret': secret } : {},
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 4, prepare: false });
  const clean = () => sql`delete from tasks where type = 'DEV_ECHO'`;
  await clean();

  console.log('\nAuth');
  check('no secret is rejected', (await worker(null)).status, 401);
  check('wrong secret is rejected', (await worker('wrong')).status, 401);
  check('correct secret is accepted', (await worker()).status, 200);

  console.log('\nA task does not run before it is due');
  const [t1] = await sql`
    insert into tasks (type, payload, due_at, idempotency_key)
    values ('DEV_ECHO', ${sql.json({ message: 'due in 10s' })}, now() + interval '10 seconds',
            ${KEY_PREFIX + 'due'})
    returning id`;
  const early = await worker();
  check('worker claims nothing', early.json.claimed, 0);
  const [stillPending] = await sql`select status, attempts from tasks where id = ${t1.id}`;
  check('task is still PENDING', stillPending.status, 'PENDING');
  check('no attempt was used', stillPending.attempts, 0);

  console.log('\nOnce due, it runs exactly once');
  await sql`update tasks set due_at = now() - interval '1 second' where id = ${t1.id}`;
  const first = await worker();
  check('worker claims it', first.json.claimed, 1);
  check('it succeeds', first.json.done, 1);
  const [afterRun] = await sql`select status, attempts from tasks where id = ${t1.id}`;
  check('task is DONE', afterRun.status, 'DONE');
  check('one attempt used', afterRun.attempts, 1);

  const third = await worker();
  check('a further run does not pick it up again', third.json.claimed, 0);

  console.log('\nIdempotency key');
  const key = KEY_PREFIX + 'once';
  for (let i = 0; i < 3; i++) {
    await sql`
      insert into tasks (type, due_at, idempotency_key)
      values ('DEV_ECHO', now() + interval '1 hour', ${key})
      on conflict (idempotency_key) do nothing`;
  }
  const [dupes] = await sql`select count(*)::int as n from tasks where idempotency_key = ${key}`;
  check('three enqueues with one key make one row', dupes.n, 1);

  console.log('\nTwo workers never take the same task');
  await clean();
  await sql`
    insert into tasks (type, payload, due_at)
    select 'DEV_ECHO', ${sql.json({ message: 'race' })}, now() - interval '1 second'
    from generate_series(1, 20)`;
  const runs = await Promise.all([worker(), worker(), worker()]);
  const totalClaimed = runs.reduce((sum, r) => sum + (r.json?.claimed ?? 0), 0);
  check('20 tasks claimed exactly once in total', totalClaimed, 20);
  const [done] = await sql`select count(*)::int as n from tasks where type='DEV_ECHO' and status='DONE'`;
  check('all 20 are DONE', done.n, 20);
  const [overRun] = await sql`
    select count(*)::int as n from tasks where type='DEV_ECHO' and attempts > 1`;
  check('none ran twice', overRun.n, 0);

  console.log('\nA failing task retries, then gives up');
  await clean();
  const [bad] = await sql`
    insert into tasks (type, payload, due_at)
    values ('DEV_ECHO', ${sql.json({ fail: true, message: 'boom' })}, now() - interval '1 second')
    returning id`;

  const failRun = await worker();
  check('it is reported as a retry', failRun.json.retry, 1);
  const [afterFail] = await sql`select status, attempts, last_error, due_at from tasks where id = ${bad.id}`;
  check('back to PENDING', afterFail.status, 'PENDING');
  check('attempt counted', afterFail.attempts, 1);
  check('error recorded', String(afterFail.last_error).includes('boom'), true);
  check('retry is scheduled in the future', new Date(afterFail.due_at) > new Date(), true);

  // Force it through the remaining attempts.
  for (let i = 2; i <= 5; i++) {
    await sql`update tasks set due_at = now() - interval '1 second' where id = ${bad.id}`;
    await worker();
  }
  const [dead] = await sql`select status, attempts from tasks where id = ${bad.id}`;
  check('FAILED after 5 attempts', dead.status, 'FAILED');
  check('attempts stopped at 5', dead.attempts, 5);
  await sql`update tasks set due_at = now() - interval '1 second' where id = ${bad.id}`;
  const afterDead = await worker();
  check('a FAILED task is never retried', afterDead.json.claimed, 0);

  console.log('\nA crashed worker cannot strand a task');
  await clean();
  const [stuck] = await sql`
    insert into tasks (type, due_at, status, attempts, started_at)
    values ('DEV_ECHO', now() - interval '1 hour', 'RUNNING', 1, now() - interval '30 minutes')
    returning id`;
  const rescueRun = await worker();
  check('it is rescued and re-run', rescueRun.json.rescued >= 1, true);
  const [rescued] = await sql`select status from tasks where id = ${stuck.id}`;
  check('it finishes', rescued.status, 'DONE');

  console.log('\nUnbuilt task types fail loudly');
  await sql`delete from tasks where type = 'SEND_FIRST_MESSAGE'`;
  const [future] = await sql`
    insert into tasks (type, due_at) values ('SEND_FIRST_MESSAGE', now() - interval '1 second')
    returning id`;
  await worker();
  const [notImpl] = await sql`select status, last_error from tasks where id = ${future.id}`;
  check('marked for retry, not silently done', notImpl.status, 'PENDING');
  check('error says it is a later phase', String(notImpl.last_error).includes('later phase'), true);
  await sql`delete from tasks where id = ${future.id}`;

  await clean();
  await sql.end();

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\nverify failed to run:', e.message);
  console.error('Is the dev server running? (npm run dev)');
  process.exit(1);
});
