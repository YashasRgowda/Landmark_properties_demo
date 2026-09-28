/**
 * Reliability test — break everything on purpose, and check no buyer is ever
 * left without an answer.
 *
 *   npm run verify:reliability
 *
 * Runs the REAL server code against a fake Google and a fake WhatsApp that this
 * script controls, so it can make the AI hang forever, overload a model, or
 * have WhatsApp refuse a send, on demand. Uses reserved test numbers only and
 * always switches the AI back on, pass or fail.
 *
 * Each scenario is a way the live demo can go wrong. The promise under test:
 * every buyer message gets exactly one answer, in time — Meera's if she can,
 * the fallback if not. Never silence, never twice.
 */
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import postgres from 'postgres';

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000';
const META_PORT = Number(process.env.FAKE_META_PORT ?? 4599);
const GEMINI_PORT = 4598;
const PREFIX = '9190000003';

const sql = postgres(process.env.DATABASE_URL!, { max: 4, prepare: false });

let passed = 0;
let failed = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `  — ${detail}`}`);
  if (ok) passed++;
  else { failed++; failures.push(`${label}${detail ? ` — ${detail}` : ''}`); }
}

/* ------------------------------------------------------------ fake Google */

const gemini = {
  mode: 'ok' as 'ok' | 'hang',
  overloaded: new Set<string>(),
  text: 'Hello! Our 30x40 plots at Ashraya are ₹42 lakh. Would you like to visit?',
  /** What The Reader "reads" — scripted, so a booking does not depend on Google's mood. */
  reader: { language: 'english', summary: 'Test buyer.', visit_agreed: false } as Record<string, unknown>,
};

function startGemini(): Promise<Server> {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const model = /models\/([^:]+):/.exec(req.url ?? '')?.[1] ?? '';
      if (gemini.overloaded.has(model)) {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'This model is currently experiencing high demand.' } }));
        return;
      }
      if (gemini.mode === 'hang') return; // never answer; the caller must give up

      const wantsJson = /application\/json/.test(body);
      const text = wantsJson ? JSON.stringify(gemini.reader) : gemini.text;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20 },
      }));
    });
  });
  return new Promise((resolve) => server.listen(GEMINI_PORT, () => resolve(server)));
}

/* ---------------------------------------------------------- fake WhatsApp */

const meta = { failNext: 0, failAll: false, textSends: 0, attempts: 0 };

function startMeta(): Promise<Server> {
  let n = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let type = '';
      try { type = JSON.parse(body).type; } catch { /* ignore */ }
      if (type === 'text') meta.attempts++;

      if (type === 'text' && (meta.failAll || meta.failNext > 0)) {
        if (meta.failNext > 0) meta.failNext--;
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Service temporarily unavailable', code: 2 } }));
        return;
      }
      if (type === 'text') meta.textSends++;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ messages: [{ id: `wamid.rel_${++n}_${Date.now()}` }] }));
    });
  });
  return new Promise((resolve) => server.listen(META_PORT, () => resolve(server)));
}

/* ---------------------------------------------------------------- helpers */

const sign = (b: string) =>
  'sha256=' + createHmac('sha256', process.env.WHATSAPP_APP_SECRET!).update(b, 'utf8').digest('hex');

let seq = 0;
/** A buyer message through the real, signed webhook. Returns its Meta id. */
async function buyerSays(phone: string, text: string, secondsAgo = 0): Promise<string> {
  const id = `wamid.rel.in.${Date.now()}.${++seq}`;
  const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{
    id, from: phone, type: 'text',
    timestamp: String(Math.floor(Date.now() / 1000) - secondsAgo),
    text: { body: text },
  }] } }] }] });
  await fetch(`${BASE}/api/webhooks/whatsapp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
    body,
  });
  return id;
}

async function worker() {
  return fetch(`${BASE}/api/cron/worker`, { headers: { 'x-cron-secret': process.env.CRON_SECRET! } })
    .then((r) => r.json());
}

async function eventually<T>(what: () => Promise<T | null | undefined | false>, ms: number): Promise<T | null> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const v = await what();
    if (v) return v as T;
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

async function replies(phone: string) {
  return sql`select body, reply_to_wa_message_id as reply_to, sent_at from messages
             where lead_id = (select id from leads where phone = ${phone})
               and direction = 'outbound' and template_name is null
               and body not like '[document:%'
             order by sent_at`;
}

async function setAi(base: string | null) {
  const q = base ? `?base=${encodeURIComponent(base)}` : '?restore=1';
  await fetch(`${BASE}/api/dev/break-ai${q}`, {
    method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET! },
  }).catch(() => null);
}

async function clean() {
  await sql`delete from leads where phone like ${PREFIX + '%'}`;
  await sql`delete from tasks where env = 'local' and type in ('DEV_ECHO') and payload->>'reliability' = 'yes'`;
}

/* -------------------------------------------------------------- scenarios */

async function main() {
  await clean();
  await setAi(`http://localhost:${GEMINI_PORT}/v1beta`);

  console.log('\n1. Google hangs forever');
  {
    const phone = `${PREFIX}01`;
    gemini.mode = 'hang';
    const started = Date.now();
    await buyerSays(phone, 'hi');
    const got = await eventually(async () => (await replies(phone))[0], 50_000);
    const took = (Date.now() - started) / 1000;
    check('the buyer still got an answer', Boolean(got), 'SILENCE');
    check('it was the fallback, with a person to call', /sales head|Ravi|\+91/i.test(String(got?.body)),
      String(got?.body).slice(0, 80));
    check('inside the platform’s 60-second limit, with room to spare', took < 35, `${took.toFixed(1)}s`);
    console.log(`    → answered in ${took.toFixed(1)}s`);
    gemini.mode = 'ok';
  }

  console.log('\n2. The best model is overloaded (what happened on the demo night)');
  {
    const phone = `${PREFIX}02`;
    gemini.overloaded = new Set(['gemini-3.5-flash', 'gemini-flash-latest']);
    const started = Date.now();
    await buyerSays(phone, 'what is the price of a 30x40 plot?');
    const got = await eventually(async () => (await replies(phone))[0], 40_000);
    const took = (Date.now() - started) / 1000;
    check('a real answer, not the fallback', Boolean(got) && !/sales head will call/i.test(String(got?.body)),
      String(got?.body).slice(0, 80));
    check('and quickly — not the 39 seconds of the demo', took < 10, `${took.toFixed(1)}s`);
    console.log(`    → answered in ${took.toFixed(1)}s`);
    gemini.overloaded = new Set();
  }

  console.log('\n3. WhatsApp refuses the send once');
  {
    const phone = `${PREFIX}03`;
    meta.failNext = 1;
    const before = meta.textSends;
    await buyerSays(phone, 'hello');
    const got = await eventually(async () => (await replies(phone))[0], 30_000);
    check('the reply still reached him', Boolean(got), 'lost');
    check('delivered exactly once', meta.textSends - before === 1, `${meta.textSends - before} sends`);
  }

  console.log('\n4. WhatsApp refuses every send — the reply must not be quietly dropped');
  {
    const phone = `${PREFIX}04`;
    meta.failAll = true;
    const inbound = await buyerSays(phone, 'is the site open on Sunday?');
    const task = await eventually(async () => {
      const [t] = await sql`select status, attempts, last_error from tasks
        where type = 'PROCESS_WA_EVENT' and payload->'event'->>'waMessageId' = ${inbound}`;
      return t && t.status !== 'RUNNING' && t.attempts >= 1 ? t : null;
    }, 45_000);
    check('the task is waiting to retry, not marked done', task?.status === 'PENDING',
      `status=${task?.status}`);
    check('and it says why', /did not accept/i.test(String(task?.last_error)), String(task?.last_error));

    // WhatsApp recovers; the retry comes round.
    meta.failAll = false;
    await sql`update tasks set due_at = now() - interval '1 second'
              where type = 'PROCESS_WA_EVENT' and payload->'event'->>'waMessageId' = ${inbound}`;
    await worker();
    const got = await eventually(async () => (await replies(phone))[0], 30_000);
    check('the retry delivered the reply', Boolean(got), 'still lost');
    check('exactly once', (await replies(phone)).length === 1, `${(await replies(phone)).length} replies`);
  }

  console.log('\n5. A stranded old message wakes up late (the demo’s double reply)');
  {
    const phone = `${PREFIX}05`;
    const hi = await buyerSays(phone, 'hi', 120);
    await eventually(async () => (await replies(phone))[0], 30_000);
    await buyerSays(phone, 'I am planning to invest, can I get a better price?');
    await eventually(async () => (await replies(phone)).length >= 2 ? true : null, 30_000);
    const before = (await replies(phone)).length;

    // Replay the "hi" task, exactly as the stuck-task rescue would.
    const [orig] = await sql`select payload from tasks
      where type = 'PROCESS_WA_EVENT' and payload->'event'->>'waMessageId' = ${hi}`;
    const [replay] = await sql`insert into tasks (type, payload, due_at, idempotency_key, env)
      values ('PROCESS_WA_EVENT', ${sql.json(orig.payload)}, now(), ${'rel.replay.' + Date.now()}, 'local')
      returning id`;
    await worker();
    // Whichever worker picks it up — a background one may still be running
    // from the last message — the job must finish cleanly and send nothing.
    const done = await eventually(async () => {
      const [t] = await sql`select status from tasks where id = ${replay.id}`;
      return t?.status === 'DONE' ? t : null;
    }, 20_000);
    const after = (await replies(phone)).length;
    check('no second answer to the same question', after === before, `${before} → ${after} replies`);
    check('the replayed job finished cleanly rather than failing', Boolean(done), 'did not finish');
  }

  console.log('\n6. Two quick messages');
  {
    const phone = `${PREFIX}06`;
    const m1 = await buyerSays(phone, 'hi');
    const m2 = await buyerSays(phone, 'what is the rate per sq ft?');
    await eventually(async () => {
      const r = await replies(phone);
      return r.some((x) => x.reply_to === m2) ? true : null;
    }, 40_000);
    const all = await replies(phone);
    check('his latest message is answered', all.some((x) => x.reply_to === m2),
      all.map((x) => x.reply_to).join(', '));
    const tos = all.map((x) => x.reply_to);
    check('nothing is answered twice', new Set(tos).size === tos.length, tos.join(', '));
    void m1;
  }

  console.log('\n7. The laptop cannot steal a production job');
  {
    const [row] = await sql`insert into tasks (type, payload, due_at, env)
      values ('DEV_ECHO', ${sql.json({ reliability: 'yes', message: 'prod job' })}, now() - interval '1 second', 'production')
      returning id`;
    await worker();
    const [t] = await sql`select status, attempts from tasks where id = ${row.id}`;
    check('a production job is left alone by the local worker', t.status === 'PENDING' && t.attempts === 0,
      `status=${t.status} attempts=${t.attempts}`);
    await sql`delete from tasks where id = ${row.id}`;
  }

  console.log('\n8. A buyer reply jumps the queue');
  {
    const phone = `${PREFIX}08`;
    await sql`insert into leads (phone, source, status, wa_state) values (${phone}, 'website', 'CHATTING', 'REPLIED')`;
    const [lead] = await sql`select id from leads where phone = ${phone}`;
    for (let i = 0; i < 3; i++) {
      await sql`insert into tasks (lead_id, type, due_at, idempotency_key, env)
                values (${lead.id}, 'RUN_READER', now() - interval '5 minutes', ${'rel.reader.' + i + '.' + Date.now()}, 'local')`;
    }
    const inbound = `wamid.rel.jump.${Date.now()}`;
    await sql`insert into tasks (type, payload, due_at, idempotency_key, env) values ('PROCESS_WA_EVENT',
      ${sql.json({ event: { kind: 'message', waMessageId: inbound, from: phone, body: 'hello?',
        timestamp: new Date().toISOString() } })}, now(), ${'rel.jump.' + Date.now()}, 'local')`;
    const report = await worker();
    const order = (report.tasks ?? []).map((t: { type: string }) => t.type);
    check('the reply ran before older background work', order[0] === 'PROCESS_WA_EVENT', order.join(' → '));
  }

  console.log('\n9. A job cut off mid-run is rescued in minutes, not ten');
  {
    const [row] = await sql`insert into tasks (type, payload, due_at, status, attempts, started_at, env)
      values ('DEV_ECHO', ${sql.json({ reliability: 'yes' })}, now() - interval '3 minutes', 'RUNNING', 1,
              now() - interval '2 minutes', 'local') returning id`;
    await worker();
    const [t] = await sql`select status from tasks where id = ${row.id}`;
    check('a job stuck for 2 minutes is picked back up', t.status !== 'RUNNING', `status=${t.status}`);
    await sql`delete from tasks where id = ${row.id}`;
  }

  console.log('\n10. A 99acres lead gets his first WhatsApp without anyone running anything');
  {
    const phone = `${PREFIX}10`;
    const templatesBefore = await sql`select count(*)::int n from messages where template_name is not null`;
    const res = await fetch(`${BASE}/api/leads/intake`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webhook-secret': process.env.LEAD_WEBHOOK_SECRET! },
      body: JSON.stringify({ name: 'Portal Buyer', phone, source: '99acres', project: 'Ashraya' }),
    });
    check('intake accepted him', res.status === 201, `HTTP ${res.status}`);
    // Deliberately NOT calling the worker: in production nothing else would.
    const sent = await eventually(async () => {
      const [m] = await sql`select template_name from messages
        where lead_id = (select id from leads where phone = ${phone}) and direction = 'outbound'`;
      return m;
    }, 20_000);
    check('his opening WhatsApp went out on its own', Boolean(sent), 'never sent');
    void templatesBefore;
  }

  console.log('\n11. A buyer moves his visit (the "See you Saturday at 5 PM" bug)');
  {
    const phone = `${PREFIX}11`;
    /** An IST wall-clock time N days from now, as the Reader would report it. */
    const istIso = (daysAhead: number, hour: number) => {
      const d = new Date(Date.now() + daysAhead * 86_400_000 + 330 * 60_000);
      const ymd = d.toISOString().slice(0, 10);
      return `${ymd}T${String(hour).padStart(2, '0')}:00:00+05:30`;
    };
    const istHour = (at: Date) => Number(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(at));

    const drain = () => eventually(async () => {
      const [b] = await sql`select count(*)::int as n from tasks
        where env = 'local' and (status = 'RUNNING' or (status = 'PENDING' and due_at <= now()))`;
      return b.n === 0 ? true : (await worker(), null);
    }, 30_000);

    gemini.reader = { language: 'english', summary: 'Wants to visit.', visit_agreed: true,
      visit_datetime_iso: istIso(5, 11), visit_label: 'Sunday 11 AM' };
    await buyerSays(phone, 'I will come on Sunday at 11 AM');
    await drain();
    const first = await sql`select visit_at, label from visits
      where lead_id = (select id from leads where phone = ${phone})`;
    check('the first visit is booked', first.length === 1, `${first.length} visits`);
    check('at 11 AM', first.length === 1 && istHour(first[0].visit_at) === 11,
      first[0] ? `${istHour(first[0].visit_at)}:00` : 'none');

    // He changes his mind. The Reader now reports the NEW, final time.
    gemini.reader = { language: 'english', summary: 'Moved his visit.', visit_agreed: true,
      visit_datetime_iso: istIso(4, 17), visit_label: 'Saturday 5 PM' };
    await buyerSays(phone, 'Sunday is not possible, can I come Saturday at 5 PM instead?');
    await drain();
    const moved = await sql`select visit_at, label from visits
      where lead_id = (select id from leads where phone = ${phone})`;
    check('still exactly one visit — moved, not duplicated', moved.length === 1, `${moved.length} visits`);
    check('THE BUG: it moved to 5 PM', moved.length === 1 && istHour(moved[0].visit_at) === 17,
      moved[0] ? `still ${istHour(moved[0].visit_at)}:00 (“${moved[0].label}”)` : 'none');
    check('with his new words as the label', moved[0]?.label === 'Saturday 5 PM', String(moved[0]?.label));

    // The model gets the hour wrong, but the label is right: the buyer's own
    // words win (this is how 5 PM was once stored as 6 PM).
    gemini.reader = { language: 'english', summary: 'Confirmed.', visit_agreed: true,
      visit_datetime_iso: istIso(4, 18), visit_label: 'Saturday 5 PM' };
    await buyerSays(phone, 'yes confirm Saturday 5 PM');
    await drain();
    const [kept] = await sql`select visit_at from visits
      where lead_id = (select id from leads where phone = ${phone})`;
    check('a wrong hour from the AI is overruled by his own words', istHour(kept.visit_at) === 17,
      `${istHour(kept.visit_at)}:00`);

    gemini.reader = { language: 'english', summary: 'Test buyer.', visit_agreed: false };
  }

  // Let background work for the test leads finish before deleting them, or it
  // fails trying to write against a lead that has gone.
  await eventually(async () => {
    const [b] = await sql`select count(*)::int as n from tasks
      where env = 'local' and (status = 'RUNNING' or (status = 'PENDING' and due_at <= now()))`;
    return b.n === 0 ? true : (await worker(), null);
  }, 30_000);
  await clean();
}

let geminiServer: Server | undefined;
let metaServer: Server | undefined;
try {
  metaServer = await startMeta();
  geminiServer = await startGemini();
  await main();
} catch (e) {
  console.error('\nverify failed to run:', (e as Error).message);
  console.error('Is the dev server running? (npm run dev)');
  failed++;
} finally {
  await setAi(null);                          // the AI always goes back on
  await clean().catch(() => null);
  await sql.end();
  geminiServer?.close();
  metaServer?.close();
}

if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  · ${f}`);
}
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`);
process.exitCode = failed === 0 ? 0 : 1;
