/**
 * Phase 7 acceptance test — the screens.
 *
 *   npm run verify:phase7
 *
 * Loads every screen as a real admin and a real agent would, checks what is on
 * it, and runs the spec's acceptance test: change a plot price, ask the bot the
 * price, and it quotes the new one.
 *
 * LOCALHOST ONLY. Pages are loaded with a session signed by the AUTH_SECRET in
 * .env.local for the existing admin account — no password is used or needed —
 * and the script refuses to run against any other host.
 *
 * The project data is shared with the live system, so the price change is
 * snapshotted first and restored exactly afterwards, pass or fail.
 */
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import postgres from 'postgres';
import { SignJWT } from 'jose';
import { checkProjectForm, projectToForm } from '../lib/project-validate';
import type { ProjectInfo } from '../lib/project-data-values';

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error(`Refusing to run against ${BASE}: this test signs its own sessions and is for localhost only.`);
  process.exit(1);
}
const META_PORT = Number(process.env.FAKE_META_PORT ?? 4599);
const GEMINI_PORT = 4598;
const PREFIX = '9190000005';

const sql = postgres(process.env.DATABASE_URL!, { max: 4, prepare: false, onnotice: () => {} });

let passed = 0;
let failed = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `  — ${detail}`}`);
  if (ok) passed++;
  else { failed++; failures.push(`${label}${detail ? ` — ${detail}` : ''}`); }
}

/* ---------------------------------------------- sessions for local testing */

async function sessionFor(email: string): Promise<string | null> {
  const [u] = await sql`select id, email, role from users where email = ${email}`;
  if (!u) return null;
  const token = await new SignJWT({ userId: u.id, email: u.email, role: u.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')   // short-lived: long enough for this run, no longer
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
  return `landmark_session=${token}`;
}

async function page(path: string, cookie: string | null) {
  const res = await fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
  const html = res.status === 200 ? await res.text() : '';
  return { status: res.status, location: res.headers.get('location') ?? '', html };
}

/** Visible text, roughly: tags out, entities decoded enough to search. */
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"').replace(/\s+/g, ' ');

/* -------------------------------------------- scripted Google, fake Meta */

function startGemini(): Promise<Server> {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      // Answer the price question from whatever price Meera was given — so the
      // reply proves what the system prompt contained.
      const price = /30x40 \(\d+ sq ft\) — (₹[\d.,]+ (?:lakh|crore))/.exec(body)?.[1] ?? 'unknown';
      const wantsJson = /application\/json/.test(body);
      const answer = wantsJson
        ? JSON.stringify({ language: 'english', summary: 'Asked the price.', visit_agreed: false })
        : `A 30x40 plot at Ashraya is ${price}. Would you like to visit this weekend?`;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: answer }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 } }));
    });
  });
  return new Promise((resolve) => server.listen(GEMINI_PORT, () => resolve(server)));
}

const sentTexts: string[] = [];
function startMeta(): Promise<Server> {
  let n = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try { const p = JSON.parse(body); if (p.text?.body) sentTexts.push(p.text.body); } catch { /* ignore */ }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ messages: [{ id: `wamid.p7_${++n}_${Date.now()}` }] }));
    });
  });
  return new Promise((resolve) => server.listen(META_PORT, () => resolve(server)));
}

async function setAi(base: string | null) {
  await fetch(`${BASE}/api/dev/break-ai${base ? `?base=${encodeURIComponent(base)}` : '?restore=1'}`, {
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

async function buyerSays(phone: string, body: string) {
  const payload = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{
    id: `wamid.p7.in.${Date.now()}.${Math.random()}`, from: phone, type: 'text',
    timestamp: String(Math.floor(Date.now() / 1000)), text: { body },
  }] } }] }] });
  await fetch(`${BASE}/api/webhooks/whatsapp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json',
      'x-hub-signature-256': 'sha256=' + createHmac('sha256', process.env.WHATSAPP_APP_SECRET!).update(payload).digest('hex') },
    body: payload,
  });
  await settle();
}

/* ------------------------------------------------------------------ main */

let originalProject: ProjectInfo | null = null;
let hadProjectRow = false;

async function main() {
  await sql`delete from leads where phone like ${PREFIX + '%'}`;
  await sql`delete from agents where email like 'p7-%@landmark.test'`;

  const admin = await sessionFor('admin@landmark.test');
  const agent = await sessionFor('agent@landmark.test');
  if (!admin) throw new Error('admin@landmark.test does not exist — the screens cannot be loaded as an admin');

  // Some data for the screens to show.
  const [hot] = await sql`insert into leads (phone, name, source, status, category, score, wa_state, summary)
    values (${PREFIX + '01'}, 'Priya Hot', '99acres', 'WITH_AGENT', 'HOT', 12, 'REPLIED', 'Wants a 30x40, 50 lakh')
    returning id`;
  const [warm] = await sql`insert into leads (phone, name, source, status, category, score, wa_state)
    values (${PREFIX + '02'}, 'Arun Warm', 'magicbricks', 'CHATTING', 'WARM', 6, 'REPLIED') returning id`;
  await sql`insert into visits (lead_id, visit_at, label, status)
    values (${hot.id}, now() + interval '3 hours', 'today evening', 'BOOKED'),
           (${warm.id}, now() - interval '5 hours', 'this morning', 'BOOKED')`;
  await sql`insert into call_tasks (lead_id, reason, priority, due_at, notes)
    values (${hot.id}, 'LATE_STAGE', 10, now() - interval '5 minutes', 'Was close to buying')`;

  console.log('\nEvery screen loads for an admin');
  const screens: [string, string, RegExp][] = [
    ['/app', 'Today', /Calls to make.*Hot buyers.*Visits today/],
    ['/app/leads', 'Leads', /Priya Hot/],
    [`/app/leads/${hot.id}`, 'the buyer’s page', /What happens next.*Automatic follow-up/],
    ['/app/calls', 'Calls', /Priya Hot/],
    ['/app/visits', 'Visits', /Did they come\?.*Arun Warm/],
    ['/admin/project', 'Project details', /Plots.*Prices and offers.*Save/],
    ['/admin/agents', 'Sales team', /active agent.*Add someone to the team/],
  ];
  for (const [path, name, expect] of screens) {
    const r = await page(path, admin);
    const t = text(r.html);
    check(`${name} (${path.replace(hot.id, ':id')})`, r.status === 200 && expect.test(t) && !/Application error|Internal Server Error/.test(t),
      r.status !== 200 ? `HTTP ${r.status} → ${r.location}` : `missing ${expect}`);
  }

  console.log('\nThe Today screen');
  {
    const t = text((await page('/app', admin)).html);
    check('raises the "about to buy" alert for the owner', /about to buy and went quiet/.test(t));
    check('flags the past visit nobody marked', /site visits? ha(s|ve) passed.*who came/.test(t));
  }

  console.log('\nLeads: filters and search');
  {
    const hotOnly = text((await page('/app/leads?category=HOT', admin)).html);
    check('category filter shows HOT leads', /Priya Hot/.test(hotOnly));
    check('...and hides the others', !/Arun Warm/.test(hotOnly));
    const byPhone = text((await page(`/app/leads?q=${encodeURIComponent('+91 90000 00502')}`, admin)).html);
    check('a phone search finds him, however the number is written', /Arun Warm/.test(byPhone) && !/Priya Hot/.test(byPhone));
    const byName = text((await page('/app/leads?q=priya', admin)).html);
    check('a name search works, any case', /Priya Hot/.test(byName));
    const leadsHtml = (await page('/app/leads', admin)).html;
    check('each lead opens his own page', leadsHtml.includes(`/app/leads/${hot.id}`));
  }

  console.log('\nWho can see what');
  {
    const out = await page('/app/visits', null);
    check('signed out → sent to sign in', out.status >= 300 && out.status < 400 && out.location.includes('/login'), `${out.status} ${out.location}`);
    if (agent) {
      const r = await page('/admin/project', agent);
      check('an agent cannot open the project editor', r.status >= 300 && r.status < 400 && !r.location.includes('/admin'), `${r.status} ${r.location}`);
      const v = await page('/app/visits', agent);
      check('...but can open Visits', v.status === 200);
    }
  }

  console.log('\nTHE ACCEPTANCE TEST — change a plot price, and the bot quotes the new one');
  {
    const [row] = await sql`select data from project_data where id = 1`;
    hadProjectRow = Boolean(row);
    originalProject = row?.data ?? null;
    if (!originalProject) throw new Error('no project data to change');

    const before = originalProject.plots.find((p) => p.size === '30x40')?.price;
    const newPrice = before === '₹44 lakh' ? '₹46 lakh' : '₹44 lakh';

    // Exactly what the Save button does: validate the form, then store it.
    const form = projectToForm(originalProject);
    const idx = originalProject.plots.findIndex((p) => p.size === '30x40');
    const result = checkProjectForm({ ...form, [`plot_price_${idx}`]: newPrice });
    check('the edit passes the checks', result.ok, result.ok ? '' : result.errors.join('; '));
    if (!result.ok) return;
    // 30x40 is the cheapest size, so the starting price must move with it.
    check('the starting price moves with the cheapest plot', result.data.entry_price === newPrice,
      result.data.entry_price);
    await sql`update project_data set data = ${sql.json(result.data as never)}, updated_at = now() where id = 1`;

    // Input values live in attributes, so look at the HTML, not the visible text.
    const editor = (await page('/admin/project', admin)).html;
    check('the editor shows the new price', editor.includes(newPrice));

    await setAi(`http://localhost:${GEMINI_PORT}/v1beta`);
    await buyerSays(`${PREFIX}03`, 'What is the price of a 30x40 plot?');
    const reply = sentTexts.at(-1) ?? '';
    check(`the very next reply quotes ${newPrice}`, reply.includes(newPrice), reply);
    check(`...and not the old ${before}`, !reply.includes(String(before)), reply);
  }

  console.log('\nA deactivated agent never gets a hot lead');
  {
    const [gone] = await sql`insert into agents (name, email, languages, active)
      values ('P7 Left', 'p7-left@landmark.test', ARRAY['english','kannada'], false) returning id`;
    await sql`update leads set owner_agent_id = ${gone.id}, language = 'kannada' where id = ${hot.id}`;
    await sql`delete from call_tasks where lead_id = ${hot.id}`;
    await sql`insert into tasks (lead_id, type, due_at, idempotency_key, env)
      values (${hot.id}, 'ESCALATE_TO_AGENT', now(), ${'p7.esc.' + Date.now()}, 'local')`;
    await settle();
    const [l] = await sql`select owner_agent_id from leads where id = ${hot.id}`;
    const [call] = await sql`select agent_id from call_tasks where lead_id = ${hot.id} and status = 'PENDING'`;
    check('his hot lead is handed to someone active', l.owner_agent_id && l.owner_agent_id !== gone.id);
    check('and so is the call', call?.agent_id && call.agent_id !== gone.id);
  }
}

let gemini: Server | undefined;
let meta: Server | undefined;
try {
  meta = await startMeta();
  gemini = await startGemini();
  await main();
} catch (e) {
  console.error('\nverify failed to run:', (e as Error).message);
  console.error('Is the dev server running? (npm run dev)');
  failed++;
} finally {
  // Put the live project data back exactly as it was.
  if (hadProjectRow && originalProject) {
    await sql`update project_data set data = ${sql.json(originalProject as never)}, updated_at = now() where id = 1`;
    const [check2] = await sql`select data from project_data where id = 1`;
    const same = JSON.stringify(check2.data) === JSON.stringify(originalProject);
    console.log(`\n  ${same ? '✓' : '✗'} live project data restored exactly`);
    if (!same) { failed++; failures.push('project data was NOT restored exactly'); } else passed++;
  }
  await setAi(null);
  await settle().catch(() => null);
  await sql`delete from leads where phone like ${PREFIX + '%'}`.catch(() => null);
  await sql`delete from agents where email like 'p7-%@landmark.test'`.catch(() => null);
  await sql.end();
  gemini?.close();
  meta?.close();
}

if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  · ${f}`);
}
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`);
process.exitCode = failed === 0 ? 0 : 1;
