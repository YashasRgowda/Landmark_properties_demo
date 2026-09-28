/**
 * Phase 8 acceptance test — hardening.
 *
 *   npm run verify:phase8
 *
 * The spec's test first: kill the AI and send a message — the buyer still gets
 * the fallback, the failing job retries, and it appears in /app/debug/failed.
 * Then the rate limits, the seed data, and that seeded test numbers are never
 * followed up.
 *
 * LOCALHOST ONLY (it signs its own admin session). The AI is always switched
 * back on and the seed data always removed at the end.
 */
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import postgres from 'postgres';
import { SignJWT } from 'jose';

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error(`Refusing to run against ${BASE}: this test signs its own sessions and is for localhost only.`);
  process.exit(1);
}
const META_PORT = Number(process.env.FAKE_META_PORT ?? 4599);
const PREFIX = '9190000008';
const SEED_PREFIX = '9190000090';

const sql = postgres(process.env.DATABASE_URL!, { max: 4, prepare: false, onnotice: () => {} });
let passed = 0;
let failed = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `  — ${detail}`}`);
  if (ok) passed++;
  else { failed++; failures.push(`${label}${detail ? ` — ${detail}` : ''}`); }
}

async function adminCookie() {
  const [u] = await sql`select id, email, role from users where email = 'admin@landmark.test'`;
  if (!u) throw new Error('admin@landmark.test does not exist');
  const token = await new SignJWT({ userId: u.id, email: u.email, role: u.role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('10m')
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
  return `landmark_session=${token}`;
}
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
async function page(path: string, cookie: string) {
  const r = await fetch(`${BASE}${path}`, { headers: { cookie }, redirect: 'manual' });
  return { status: r.status, text: r.status === 200 ? text(await r.text()) : '' };
}

const sent: string[] = [];
function startMeta(): Promise<Server> {
  let n = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try { const p = JSON.parse(body); if (p.text?.body) sent.push(p.text.body); } catch { /* ignore */ }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ messages: [{ id: `wamid.p8_${++n}_${Date.now()}` }] }));
    });
  });
  return new Promise((resolve) => server.listen(META_PORT, () => resolve(server)));
}

async function setAi(dead: boolean) {
  await fetch(`${BASE}/api/dev/break-ai${dead ? '' : '?restore=1'}`, {
    method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET! },
  }).catch(() => null);
}

async function settle() {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    await fetch(`${BASE}/api/cron/worker`, { headers: { 'x-cron-secret': process.env.CRON_SECRET! } });
    const [b] = await sql`select count(*)::int n from tasks where env = 'local'
      and (status = 'RUNNING' or (status = 'PENDING' and due_at <= now()))`;
    if (b.n === 0) return;
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function intake(phone: string, ip: string, secret = process.env.LEAD_WEBHOOK_SECRET!) {
  return fetch(`${BASE}/api/leads/intake`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-secret': secret, 'x-forwarded-for': ip },
    body: JSON.stringify({ name: 'Rate Test', phone, source: '99acres', project: 'Ashraya' }),
  });
}

async function main() {
  await sql`delete from leads where phone like ${PREFIX + '%'}`;
  const admin = await adminCookie();

  console.log('\nTHE ACCEPTANCE TEST — kill the AI and send a message');
  {
    const phone = `${PREFIX}01`;
    await setAi(true);
    const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{
      id: `wamid.p8.in.${Date.now()}`, from: phone, type: 'text',
      timestamp: String(Math.floor(Date.now() / 1000)), text: { body: 'What is the price of a 30x40 plot?' },
    }] } }] }] });
    const before = sent.length;
    await fetch(`${BASE}/api/webhooks/whatsapp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=' + createHmac('sha256', process.env.WHATSAPP_APP_SECRET!).update(body).digest('hex') },
      body,
    });
    await settle();
    const reply = sent.slice(before).at(-1) ?? '';
    check('the buyer still gets the fallback message', /sales head|will call you/i.test(reply), reply || 'NOTHING SENT');

    const [lead] = await sql`select id from leads where phone = ${phone}`;
    const [reader] = await sql`select status, attempts, last_error from tasks
      where lead_id = ${lead.id} and type = 'RUN_READER'`;
    check('the failing job (scoring) is retried, not dropped', reader?.status === 'PENDING' && reader?.attempts >= 1,
      JSON.stringify(reader));
    check('...with the reason recorded', Boolean(reader?.last_error), String(reader?.last_error));

    const retrying = await page('/app/debug/failed', admin);
    check('the failure appears in /app/debug/failed', retrying.status === 200 && /Failing, will retry \([1-9]/.test(retrying.text)
      && /Score a lead/.test(retrying.text), retrying.status !== 200 ? `HTTP ${retrying.status}` : 'not listed');

    // Let it run out of retries, as it would over the next hour.
    await sql`update tasks set attempts = 4, due_at = now() - interval '1 second'
              where lead_id = ${lead.id} and type = 'RUN_READER'`;
    await settle();
    const [gaveUp] = await sql`select status from tasks where lead_id = ${lead.id} and type = 'RUN_READER'`;
    check('after its last retry it is marked FAILED', gaveUp.status === 'FAILED', gaveUp.status);
    const listed = await page('/app/debug/failed', admin);
    check('...and listed under "Gave up"', /Gave up \([1-9]/.test(listed.text));
    const today = await page('/app', admin);
    check('the Today screen tells the admin', /failed for good/.test(today.text));

    await setAi(false);
    await sql`update tasks set status = 'CANCELLED' where lead_id = ${lead.id} and type = 'RUN_READER'`;
  }

  console.log('\nRate limits on lead intake');
  {
    const phone = `${PREFIX}02`;
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await intake(phone, ip)).status);
    check('the same buyer posted 5 times in a minute is accepted', statuses.slice(0, 5).every((s) => s === 200 || s === 201),
      statuses.join(','));
    const sixth = statuses[5];
    check('the 6th is refused with 429 — a portal stuck in a loop', sixth === 429, String(sixth));

    const r = await intake(`${PREFIX}03`, ip);
    check('a different buyer from the same portal still gets through', r.status === 201 || r.status === 200, String(r.status));

    const attacker = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    const codes: number[] = [];
    for (let i = 0; i < 61; i++) codes.push((await intake(`${PREFIX}04`, attacker, 'wrong-secret')).status);
    check('guessing the secret is refused (401)…', codes.slice(0, 60).every((c) => c === 401), [...new Set(codes.slice(0, 60))].join(','));
    check('…and then blocked altogether (429) — the limit comes before the secret check', codes[60] === 429, String(codes[60]));
    const [created] = await sql`select count(*)::int n from leads where phone = ${PREFIX + '04'}`;
    check('none of those guesses created a lead', created.n === 0, `${created.n}`);
    await sql`delete from rate_limits where key like ${'%' + ip + '%'} or key like ${'%' + attacker + '%'}
              or key like ${'%' + PREFIX + '%'}`;
  }

  console.log('\nThe demo seed');
  {
    execFileSync('npx', ['tsx', '--env-file=.env.local', 'scripts/seed-demo.ts'], { stdio: 'pipe' });
    const seeded = await sql`select status from leads where phone like ${SEED_PREFIX + '%'}`;
    const statuses = new Set(seeded.map((r) => r.status));
    check('20 realistic leads', seeded.length === 20, `${seeded.length}`);
    check('covering every lead status', statuses.size === 13, `${statuses.size}: ${[...statuses].join(', ')}`);

    const today = await page('/app', admin);
    check('the Today screen fills up', /Priya Sharma|Pooja Hegde/.test(today.text) && /close to buying/.test(today.text));
    const visits = await page('/app/visits', admin);
    check('visits show: today, coming up, and the ones that happened', /Vikram Singh/.test(visits.text) && /Divya Menon/.test(visits.text)
      && /Sneha Patil/.test(visits.text));

    const dry = await fetch(`${BASE}/api/dev/sweep-chases?dryRun=1`, {
      method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET! },
    }).then((r) => r.json());
    const seededPhones = new Set((await sql`select id from leads where phone like ${SEED_PREFIX + '%'}`).map((r) => r.id));
    check('production would never follow up a seeded lead', !dry.enrolled.some((e: { leadId: string }) => seededPhones.has(e.leadId)),
      JSON.stringify(dry.enrolled));
    const [queued] = await sql`select count(*)::int n from tasks where lead_id in
      (select id from leads where phone like ${SEED_PREFIX + '%'})`;
    check('and no job was queued that could message one', queued.n === 0, `${queued.n}`);

    execFileSync('npx', ['tsx', '--env-file=.env.local', 'scripts/seed-demo.ts', '--remove'], { stdio: 'pipe' });
    const [left] = await sql`select count(*)::int n from leads where phone like ${SEED_PREFIX + '%'}`;
    check('one command removes them all', left.n === 0, `${left.n} left`);
  }
}

let meta: Server | undefined;
try {
  meta = await startMeta();
  await main();
} catch (e) {
  console.error('\nverify failed to run:', (e as Error).message);
  console.error('Is the dev server running? (npm run dev)');
  failed++;
} finally {
  await setAi(false);
  await settle().catch(() => null);
  await sql`delete from leads where phone like ${PREFIX + '%'}`.catch(() => null);
  await sql`delete from leads where phone like ${SEED_PREFIX + '%'}`.catch(() => null);
  await sql`delete from agents where email like 'seed-%@landmark.test'`.catch(() => null);
  await sql.end();
  meta?.close();
}

if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  · ${f}`);
}
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`);
process.exitCode = failed === 0 ? 0 : 1;
