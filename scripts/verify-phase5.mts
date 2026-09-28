/**
 * Phase 5 acceptance test — the first-hour ladder.
 *
 *   npm run verify:phase5
 *
 * Drives the real path a 99acres lead takes: intake → opening WhatsApp →
 * delivery check → a call in front of a human. Uses a fake Meta so no real
 * messages go out, and reserved numbers it deletes afterwards.
 *
 * The time-of-day branches (11 PM → 9:30 AM, 2 PM → +10 minutes) are proved
 * exhaustively in tests/first-hour.test.ts, which can set the clock. This
 * script proves the plumbing, and the invariants that must hold at ANY hour.
 */
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import postgres from 'postgres';
import { currentWindow } from '../lib/time-window';

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000';
const PHONES = {
  silent: '919000000101',   // never replies
  replier: '919000000102',  // replies straight away
  optedOut: '919000000103',
};

let passed = 0;
let failed = 0;
const failures: string[] = [];
let metaCalls = 0;

function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `  — ${detail}`}`);
  if (ok) passed++;
  else { failed++; failures.push(`${label}${detail ? ` — ${detail}` : ''}`); }
}

const sql = postgres(process.env.DATABASE_URL!, { max: 4, prepare: false });

async function intake(phone: string, name: string) {
  const res = await fetch(`${BASE}/api/leads/intake`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-webhook-secret': process.env.LEAD_WEBHOOK_SECRET!,
    },
    body: JSON.stringify({ name, phone, source: '99acres', project: 'Ashraya' }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const sign = (body: string) =>
  'sha256=' + createHmac('sha256', process.env.WHATSAPP_APP_SECRET!).update(body, 'utf8').digest('hex');

/** A real inbound WhatsApp, through the real signed webhook. */
async function buyerReplies(phone: string, text: string) {
  const body = JSON.stringify({
    entry: [{ changes: [{ value: { messages: [{
      id: `p5.in.${Date.now()}`, from: phone, type: 'text',
      timestamp: String(Math.floor(Date.now() / 1000)), text: { body: text },
    }] } }] }],
  });
  await fetch(`${BASE}/api/webhooks/whatsapp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
    body,
  });
  await worker();
}

/**
 * Run the worker, then wait until nothing local is running or due.
 *
 * Intake and the webhook now finish their own work just after responding —
 * that is the fix that makes a 99acres lead's first WhatsApp go out without
 * anyone running anything. So a job may be mid-run in the background when the
 * worker call returns, and checking at that instant reads a stale state.
 */
async function worker() {
  const deadline = Date.now() + 20_000;
  let report: { tasks?: { type: string }[] } = {};
  while (Date.now() < deadline) {
    const r = await fetch(`${BASE}/api/cron/worker`, {
      headers: { 'x-cron-secret': process.env.CRON_SECRET! },
    }).then((res) => res.json());
    if ((r.tasks ?? []).length) report = r;
    const [busy] = await sql`
      select count(*)::int as n from tasks
      where env = 'local'
        and (status = 'RUNNING' or (status = 'PENDING' and due_at <= now()))`;
    if (busy.n === 0) break;
    await new Promise((res) => setTimeout(res, 200));
  }
  return report;
}

/**
 * Wait for a condition the server reaches asynchronously.
 *
 * The webhook returns 200 and finishes the work in an `after()` block, so a
 * SELECT fired the instant the fetch resolves can read the old row. That is
 * correct server behaviour, not a bug — the test has to wait for it.
 */
async function eventually(what: () => Promise<boolean>, timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await what()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/** The delivery check is deliberately due in 2 minutes; bring it forward. */
async function pullForward(type: string) {
  await sql`update tasks set due_at = now() - interval '1 second'
            where type = ${type} and status = 'PENDING'`;
}

/**
 * Phase 5 is about the ladder, not about what Meera says. Pointing the AI at a
 * dead port makes her fall back instantly instead of spending 60s retrying a
 * rate-limited Gemini, which is all this test would be waiting for.
 */
async function setAi(working: boolean) {
  await fetch(`${BASE}/api/dev/break-ai${working ? '?restore=1' : ''}`, {
    method: 'POST',
    headers: { 'x-cron-secret': process.env.CRON_SECRET! },
  }).catch(() => null);
}

async function main() {
  await setAi(false);
  const clean = async () => {
    for (const phone of Object.values(PHONES)) {
      await sql`delete from leads where phone = ${phone}`;
    }
  };
  await clean();

  console.log(`\nIt is currently ${currentWindow(new Date())} hours in India.`);

  console.log('\nA lead drops in from 99acres');
  const created = await intake(PHONES.silent, 'Silent Buyer');
  check('intake accepted it', created.status === 200 || created.status === 201, `HTTP ${created.status}`);

  const [lead] = await sql`select * from leads where phone = ${PHONES.silent}`;
  check('a lead row exists', Boolean(lead));

  const queued = await sql`select type, status from tasks
    where lead_id = ${lead.id} and type = 'SEND_FIRST_MESSAGE'`;
  check('the opening message was queued immediately', queued.length === 1,
    `${queued.length} SEND_FIRST_MESSAGE tasks`);

  console.log('\nThe opening WhatsApp goes out — at any hour');
  const before = metaCalls;
  await worker();
  const sent = await sql`select body, template_name from messages
    where lead_id = ${lead.id} and direction = 'outbound'`;
  check('a message was actually sent to Meta', metaCalls > before, `${metaCalls - before} calls`);
  check('it is logged against the lead', sent.length >= 1, `${sent.length} outbound rows`);
  check('it went as a template, not free text', Boolean(sent[0]?.template_name), String(sent[0]?.template_name));

  const [afterSend] = await sql`select status from leads where id = ${lead.id}`;
  check('the lead is marked MESSAGE_SENT', afterSend.status === 'MESSAGE_SENT', String(afterSend.status));

  const checkTask = await sql`select due_at from tasks
    where lead_id = ${lead.id} and type = 'CHECK_DELIVERY'`;
  check('a delivery check was queued', checkTask.length === 1, `${checkTask.length} tasks`);
  if (checkTask.length) {
    const inMinutes = (new Date(checkTask[0].due_at).getTime() - Date.now()) / 60000;
    check('it is due in about two minutes', inMinutes > 0.5 && inMinutes < 3.5,
      `${inMinutes.toFixed(1)} minutes`);
  }

  console.log('\nHe does not reply, so a human is told to ring him');
  await sql`update leads set wa_state = 'DELIVERED' where id = ${lead.id}`;
  await pullForward('CHECK_DELIVERY');
  await worker();

  const calls = await sql`select * from call_tasks where lead_id = ${lead.id}`;
  check('THE HARD RULE: a call task exists', calls.length === 1, `${calls.length} call tasks`);

  if (calls.length === 1) {
    const call = calls[0];
    const due = new Date(call.due_at);
    const hour = Number(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false,
    }).format(due));
    const minutes = Number(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata', minute: '2-digit',
    }).format(due));

    check('it names why he is being rung', call.reason === 'DELIVERED_UNREAD', String(call.reason));
    check('it is never scheduled into the night',
      hour * 60 + minutes >= 9 * 60 + 30 && hour < 21, `${hour}:${String(minutes).padStart(2, '0')} IST`);
    check('it is not scheduled in the past', due.getTime() > Date.now() - 60_000, due.toISOString());
    check('it carries a reason a human can read', String(call.notes ?? '').length > 10, String(call.notes));
    check('it is waiting for an agent', call.status === 'PENDING', String(call.status));
    console.log(`    → ${call.reason} · due ${due.toISOString()} · priority ${call.priority}`);
  }

  const [statusAfter] = await sql`select status from leads where id = ${lead.id}`;
  check('the lead status matches the queue', statusAfter.status === 'DELIVERED_UNREAD',
    String(statusAfter.status));

  console.log('\nRunning the check again does not double up');
  await pullForward('CHECK_DELIVERY');
  await worker();
  const again = await sql`select count(*)::int as n from call_tasks where lead_id = ${lead.id}`;
  check('still exactly one call task', again[0].n === 1, `${again[0].n}`);

  console.log('\nA buyer who replies is never cold-called');
  await intake(PHONES.replier, 'Chatty Buyer');
  const [replier] = await sql`select * from leads where phone = ${PHONES.replier}`;
  await worker();
  await sql`update leads set wa_state = 'REPLIED' where id = ${replier.id}`;
  await pullForward('CHECK_DELIVERY');
  await worker();

  const replierCalls = await sql`select count(*)::int as n from call_tasks where lead_id = ${replier.id}`;
  check('THE ACCEPTANCE TEST: no call task at all', replierCalls[0].n === 0, `${replierCalls[0].n} call tasks`);

  console.log('\nA reply cancels a call that was already queued');
  await sql`update call_tasks set status = 'PENDING' where lead_id = ${lead.id}`;
  // The real path: a signed webhook, exactly as Meta delivers it.
  await buyerReplies(PHONES.silent, 'ok tell me more about the 30x40');

  const wasCancelled = await eventually(async () => {
    const rows = await sql`select status from call_tasks
      where lead_id = ${lead.id} and status = 'PENDING'`;
    return rows.length === 0;
  });
  const final = await sql`select status, notes from call_tasks where lead_id = ${lead.id}`;
  check('the queued call was cancelled', wasCancelled, final.map((c) => c.status).join(', '));
  check('it says why it was cancelled',
    final.some((c) => String(c.notes ?? '').includes('replied')),
    final.map((c) => c.notes).join(' | '));

  console.log('\nA buyer who said STOP is never rung');
  await intake(PHONES.optedOut, 'Opted Out');
  const [optedOut] = await sql`select * from leads where phone = ${PHONES.optedOut}`;
  await sql`update leads set opted_out = true, wa_state = 'DELIVERED' where id = ${optedOut.id}`;
  await pullForward('CHECK_DELIVERY');
  await worker();
  const optedCalls = await sql`select count(*)::int as n from call_tasks where lead_id = ${optedOut.id}`;
  check('no call task for an opted-out lead', optedCalls[0].n === 0, `${optedCalls[0].n}`);

  console.log('\nA HOT lead reaches a human');
  // Enqueued directly: the scoring that normally triggers this needs the AI,
  // and what is under test here is the handover, not the scoring.
  await sql`delete from agents where email = 'verify-agent@landmark.test'`;
  const [agent] = await sql`insert into agents (name, email, languages, active)
    values ('Verify Agent', 'verify-agent@landmark.test', ARRAY['kannada','english'], true)
    returning id, name`;
  void agent;
  await sql`update leads set language = 'kannada', category = 'HOT', score = 11,
            summary = 'Wants a 30x40, budget 45 lakh' where id = ${replier.id}`;
  await sql`insert into tasks (lead_id, type, due_at, status, idempotency_key, env)
            values (${replier.id}, 'ESCALATE_TO_AGENT', now(), 'PENDING', ${'esc.' + Date.now()}, 'local')`;

  // One pass is not enough when slow tasks are queued ahead of this one: the
  // worker has a per-request deadline and a failing RUN_READER can eat it.
  await eventually(async () => {
    await worker();
    const [l] = await sql`select owner_agent_id from leads where id = ${replier.id}`;
    return Boolean(l?.owner_agent_id);
  }, 30_000);

  const [escalated] = await sql`select owner_agent_id, status from leads where id = ${replier.id}`;
  check('the lead now has an owner', Boolean(escalated.owner_agent_id),
    `owner=${escalated.owner_agent_id}`);
  check('the lead is marked WITH_AGENT', escalated.status === 'WITH_AGENT', String(escalated.status));

  // Not "my test agent" — there may be several. What matters is the rule: a
  // Kannada buyer goes to someone who can actually talk to him.
  const [owner] = escalated.owner_agent_id
    ? await sql`select name, languages, active from agents where id = ${escalated.owner_agent_id}`
    : [];
  check('the owner speaks his language', (owner?.languages ?? []).includes('kannada'),
    `${owner?.name} speaks ${owner?.languages}`);
  check('the owner is an active agent', owner?.active === true, String(owner?.active));

  const hotCalls = await sql`select * from call_tasks
    where lead_id = ${replier.id} and reason = 'HOT_LEAD'`;
  check('a call was put in front of that agent', hotCalls.length === 1, `${hotCalls.length}`);
  if (hotCalls.length) {
    check('it is top priority', hotCalls[0].priority >= 10, `priority ${hotCalls[0].priority}`);
    check('the call is assigned to that same owner',
      hotCalls[0].agent_id === escalated.owner_agent_id, String(hotCalls[0].agent_id));
    check('it briefs the agent before he rings', String(hotCalls[0].notes ?? '').length > 10,
      String(hotCalls[0].notes));
    console.log(`    → ${owner?.name} · "${hotCalls[0].notes}"`);
  }

  console.log('\nThe same lead posted twice does not message twice');
  const repeat = await intake(PHONES.silent, 'Silent Buyer');
  void repeat;
  const firstTasks = await sql`select count(*)::int as n from tasks
    where lead_id = ${lead.id} and type = 'SEND_FIRST_MESSAGE'`;
  check('still one opening message task', firstTasks[0].n === 1, `${firstTasks[0].n}`);

  // Leads first: they hold owner_agent_id, and that foreign key blocks the
  // agent's deletion (this hung a whole run).
  await clean();
  await sql`delete from agents where email = 'verify-agent@landmark.test'`;
  await sql.end();

  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  · ${f}`);
  }
  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`);
}

const fakeMeta = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    metaCalls++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ messages: [{ id: `wamid.p5_${metaCalls}_${Date.now()}` }] }));
  });
});

/**
 * Whatever happens, the AI goes back on.
 *
 * This script switches Meera off so the ladder is not waiting on Gemini, and
 * an earlier version only switched her back on when the run FAILED. A passing
 * run therefore left the dev server talking to a dead port, and the next person
 * to open the chat simulator got the fallback message with no idea why.
 *
 * `process.exit()` skips `finally`, so the exit code is set rather than taken,
 * and it is taken only once the cleanup has run.
 */
fakeMeta.listen(Number(process.env.FAKE_META_PORT ?? 4599), async () => {
  try {
    await main();
    process.exitCode = failed === 0 ? 0 : 1;
  } catch (e) {
    console.error('\nverify failed to run:', (e as Error).message);
    console.error('Is the dev server running? (npm run dev)');
    process.exitCode = 1;
  } finally {
    await setAi(true);
    fakeMeta.close();
  }
});
