/**
 * Phase 3 acceptance test — WhatsApp.
 *
 *   npm run verify:phase3
 *
 * Runs the whole path without real Meta credentials: it stands up a fake Meta
 * API on localhost, signs webhook deliveries exactly as Meta does, and checks
 * what lands in the database.
 *
 * Uses one reserved test number and deletes it afterwards.
 */
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import postgres from 'postgres';

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000';
const APP_SECRET = process.env.WHATSAPP_APP_SECRET || 'phase3-test-app-secret';
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'phase3-test-verify-token';
const PHONE = '919000000042';

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

const sign = (body: string, secret = APP_SECRET) =>
  'sha256=' + createHmac('sha256', secret).update(body, 'utf8').digest('hex');

async function deliver(payload: unknown, secret?: string) {
  const body = JSON.stringify(payload);
  const res = await fetch(`${BASE}/api/webhooks/whatsapp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': sign(body, secret ?? APP_SECRET),
    },
    body,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

/**
 * Run the worker, then wait until every local WhatsApp job has finished.
 *
 * The webhook also processes its own event just after responding, so the job
 * may be mid-run in the background when this call returns. Checking at that
 * instant reads the state from one step earlier — correct behaviour by the
 * server, and a race in the test. So the test waits for the queue to settle.
 */
async function runWorker() {
  const settle = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const deadline = Date.now() + 15_000;
    let report: unknown = null;
    while (Date.now() < deadline) {
      report = await fetch(`${BASE}/api/cron/worker`, {
        headers: { 'x-cron-secret': process.env.CRON_SECRET! },
      }).then((r) => r.json());
      const [busy] = await settle`
        select count(*)::int as n from tasks
        where type = 'PROCESS_WA_EVENT' and env = 'local'
          and (status = 'RUNNING' or (status = 'PENDING' and due_at <= now()))`;
      if (busy.n === 0) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    return report;
  } finally {
    await settle.end();
  }
}

const msgEvent = (id: string, body: string) => ({
  entry: [
    {
      changes: [
        {
          value: {
            messages: [
              { id, from: PHONE, type: 'text', timestamp: String(Math.floor(Date.now() / 1000)),
                text: { body } },
            ],
          },
        },
      ],
    },
  ],
});

const statusEvent = (id: string, status: string, errorMessage?: string) => ({
  entry: [
    {
      changes: [
        {
          value: {
            statuses: [
              {
                id, status, recipient_id: PHONE,
                timestamp: String(Math.floor(Date.now() / 1000)),
                ...(errorMessage ? { errors: [{ message: errorMessage }] } : {}),
              },
            ],
          },
        },
      ],
    },
  ],
});

/**
 * This phase tests WhatsApp plumbing, not what Meera says. With the AI pointed
 * at a dead port she falls back instantly, so nothing here waits on Google —
 * a slow Google once made this test close its fake WhatsApp before a reply had
 * been sent. The AI is always switched back on at the end.
 */
async function setAi(working: boolean) {
  await fetch(`${BASE}/api/dev/break-ai${working ? '?restore=1' : ''}`, {
    method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET! },
  }).catch(() => null);
}

async function main() {
  await setAi(false);
  const sql = postgres(process.env.DATABASE_URL!, { max: 4, prepare: false });
  const clean = () => sql`delete from leads where phone = ${PHONE}`;
  await clean();
  await sql`delete from tasks where type = 'PROCESS_WA_EVENT' and env = 'local'`;

  console.log('\nWebhook verification (Meta subscribing)');
  const challenge = 'challenge-12345';
  const okUrl = `${BASE}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(VERIFY_TOKEN)}&hub.challenge=${challenge}`;
  const okRes = await fetch(okUrl);
  check('correct verify token echoes the challenge', await okRes.text(), challenge);
  const badRes = await fetch(
    `${BASE}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=${challenge}`,
  );
  check('wrong verify token is refused', badRes.status, 403);

  console.log('\nSignature');
  const unsigned = await fetch(`${BASE}/api/webhooks/whatsapp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(msgEvent('wamid.unsigned', 'hello')),
  });
  check('unsigned delivery is rejected', unsigned.status, 401);
  check('wrongly signed delivery is rejected',
    (await deliver(msgEvent('wamid.badsig', 'hello'), 'wrong-secret')).status, 401);
  check('correctly signed delivery is accepted',
    (await deliver(msgEvent('wamid.in1', 'Is it E-Khata?'))).status, 200);

  console.log('\nThe webhook only queues — it never processes inline');
  const [queuedBefore] = await sql`
    select count(*)::int as n from tasks where type='PROCESS_WA_EVENT' and status='PENDING'`;
  check('event is waiting in the queue', queuedBefore.n >= 1, true);
  const [noLeadYet] = await sql`select count(*)::int as n from leads where phone = ${PHONE}`;
  check('nothing written to leads yet', noLeadYet.n, 0);

  console.log('\nInbound message, once the worker runs');
  await runWorker();
  // The webhook finishes the work just after responding, so allow a moment.
  let lead: Record<string, any> | undefined;
  for (let i = 0; i < 40 && !lead; i++) {
    [lead] = await sql`select * from leads where phone = ${PHONE}`;
    if (!lead) await new Promise((r) => setTimeout(r, 250));
  }
  check('a lead now exists', Boolean(lead), true);
  if (!lead) throw new Error('no lead was created, so the rest cannot run');
  check('marked as replied', lead?.wa_state, 'REPLIED');
  check('status is CHATTING', lead?.status, 'CHATTING');
  const [msg] = await sql`select * from messages where wa_message_id = 'wamid.in1'`;
  check('message stored', msg?.body, 'Is it E-Khata?');
  check('direction inbound', msg?.direction, 'inbound');
  const [touch] = await sql`
    select count(*)::int as n from touches
    where lead_id = ${lead.id} and channel='whatsapp' and direction='inbound' and outcome='replied'`;
  check('a touch row was written', touch.n, 1);

  console.log('\nMeta redelivering the same message changes nothing');
  await deliver(msgEvent('wamid.in1', 'Is it E-Khata?'));
  await runWorker();
  const [dupes] = await sql`select count(*)::int as n from messages where wa_message_id='wamid.in1'`;
  check('still one message row', dupes.n, 1);

  console.log('\nDelivery statuses move the lead forward, never backward');
  await sql`
    insert into messages (lead_id, direction, body, wa_message_id, status)
    values (${lead.id}, 'outbound', 'price list', 'wamid.out1', 'sent')`;
  await sql`update leads set wa_state = null, status = 'MESSAGE_SENT' where id = ${lead.id}`;

  await deliver(statusEvent('wamid.out1', 'delivered'));
  await runWorker();
  const [afterDelivered] = await sql`select wa_state, status from leads where id = ${lead.id}`;
  check('delivered → DELIVERED', afterDelivered.wa_state, 'DELIVERED');
  check('status is DELIVERED_UNREAD', afterDelivered.status, 'DELIVERED_UNREAD');

  await deliver(statusEvent('wamid.out1', 'read'));
  await runWorker();
  const [afterRead] = await sql`select wa_state, status from leads where id = ${lead.id}`;
  check('read → READ', afterRead.wa_state, 'READ');
  check('status is READ_NO_REPLY', afterRead.status, 'READ_NO_REPLY');

  await deliver(statusEvent('wamid.out1', 'sent'));
  await runWorker();
  const [afterStale] = await sql`select wa_state from leads where id = ${lead.id}`;
  check('a late "sent" does not undo "read"', afterStale.wa_state, 'READ');

  console.log('\nA number that is not on WhatsApp');
  await sql`
    insert into messages (lead_id, direction, body, wa_message_id, status)
    values (${lead.id}, 'outbound', 'price list', 'wamid.out2', 'sent')`;
  await deliver(statusEvent('wamid.out2', 'failed', 'not a WhatsApp user'));
  await runWorker();
  const [failedLead] = await sql`select wa_state, status from leads where id = ${lead.id}`;
  check('marked NOT_ON_WHATSAPP', failedLead.wa_state, 'NOT_ON_WHATSAPP');
  check('status matches', failedLead.status, 'NOT_ON_WHATSAPP');

  console.log('\nSTOP opts the buyer out and cancels queued work');
  await sql`update leads set opted_out = false, wa_state = 'REPLIED' where id = ${lead.id}`;
  await sql`
    insert into tasks (lead_id, type, due_at, status, env)
    values (${lead.id}, 'DEV_ECHO', now() + interval '1 hour', 'PENDING', 'local'),
           (${lead.id}, 'DEV_ECHO', now() + interval '2 hours', 'PENDING', 'local')`;

  await deliver(msgEvent('wamid.stop', 'STOP'));
  await runWorker();
  const [optedOut] = await sql`select opted_out, status from leads where id = ${lead.id}`;
  check('lead is opted out', optedOut.opted_out, true);
  const [stillPending] = await sql`
    select count(*)::int as n from tasks where lead_id = ${lead.id} and status = 'PENDING'`;
  check('no pending tasks remain', stillPending.n, 0);
  // The two jobs planted above. Anything else pending for him — a scoring job
  // waiting to retry, say — is rightly cancelled too, so it is not counted here.
  const [cancelled] = await sql`
    select count(*)::int as n from tasks
    where lead_id = ${lead.id} and status = 'CANCELLED' and type = 'DEV_ECHO'`;
  check('they were cancelled, not deleted', cancelled.n, 2);

  console.log('\nAn opted-out buyer can never be messaged again');
  const sendRes = await fetch(`${BASE}/api/dev/send-test`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cron-secret': process.env.CRON_SECRET! },
    body: JSON.stringify({ phone: PHONE, body: 'are you still interested?' }),
  });
  const sendJson = await sendRes.json().catch(() => null);
  check('send refused', sendJson?.reason, 'OPTED_OUT');
  const [noNewOutbound] = await sql`
    select count(*)::int as n from messages
    where lead_id = ${lead.id} and direction='outbound' and body like 'are you still%'`;
  check('nothing was sent', noNewOutbound.n, 0);

  console.log('\nSending a real message (against a stand-in for Meta)');
  await sql`update leads set opted_out = false where id = ${lead.id}`;
  const sent = await fetch(`${BASE}/api/dev/send-test`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cron-secret': process.env.CRON_SECRET! },
    body: JSON.stringify({ phone: PHONE, body: 'Ashraya price list' }),
  });
  const sentJson = await sent.json().catch(() => null);
  check('send succeeded', sentJson?.ok, true);
  const [outbound] = await sql`
    select * from messages where lead_id = ${lead.id} and body = 'Ashraya price list'`;
  check('outbound message stored', Boolean(outbound), true);
  check('Meta message id kept', String(outbound?.wa_message_id).startsWith('wamid.fake'), true);
  const [outTouch] = await sql`
    select count(*)::int as n from touches
    where lead_id = ${lead.id} and direction='outbound' and outcome='sent'`;
  check('an outbound touch was written', outTouch.n >= 1, true);

  await clean();
  await sql`delete from tasks where type = 'PROCESS_WA_EVENT' and env = 'local'`;
  await sql.end();

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`);
  process.exitCode = failed === 0 ? 0 : 1;
}

/** A stand-in for graph.facebook.com so sending can be tested with no credentials. */
function startFakeMeta(port: number) {
  let n = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ messages: [{ id: `wamid.fake${++n}` }] }));
    });
  });
  return new Promise<() => void>((resolve) => {
    server.listen(port, () => resolve(() => server.close()));
  });
}

const port = Number(process.env.FAKE_META_PORT ?? 4599);
startFakeMeta(port).then(async (stop) => {
  try {
    await main();
  } catch (e) {
    console.error('\nverify failed to run:', (e as Error).message);
    console.error('Is the dev server running? (npm run dev)');
    process.exitCode = 1;
  } finally {
    await setAi(true);
    stop();
  }
});
