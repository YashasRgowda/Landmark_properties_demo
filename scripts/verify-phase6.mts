/**
 * Phase 6 acceptance test — follow-ups for quiet buyers, and visit reminders.
 *
 *   npm run verify:phase6
 *
 * Runs the real server code against a scripted Google and a fake WhatsApp.
 * Buyers' histories are backdated in the database, so "quiet for two days" is
 * real data rather than a switch. Test numbers only (9190000004xx); the AI is
 * always switched back on at the end.
 *
 * The spec's acceptance test is scenario 1. The rest cover each sequence, the
 * WhatsApp 24-hour rule, the Writer's price check, visit reminders, and every
 * way a follow-up must stop.
 */
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import postgres from 'postgres';

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000';
const META_PORT = Number(process.env.FAKE_META_PORT ?? 4599);
const GEMINI_PORT = 4598;
const PREFIX = '9190000004';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const sql = postgres(process.env.DATABASE_URL!, { max: 4, prepare: false, onnotice: () => {} });

let passed = 0;
let failed = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `  — ${detail}`}`);
  if (ok) passed++;
  else { failed++; failures.push(`${label}${detail ? ` — ${detail}` : ''}`); }
}

/* ------------------------------------------------------- scripted Google */

const gemini = {
  inventPrice: false,
  reader: { language: 'english', summary: 'Test buyer.', visit_agreed: false } as Record<string, unknown>,
};

function startGemini(): Promise<Server> {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const wantsJson = /application\/json/.test(body);
      let text: string;
      if (wantsJson) text = JSON.stringify(gemini.reader);
      else if (gemini.inventPrice) text = 'Special this week only: plots at just ₹39 lakh! Shall I hold one?';
      else if (/Offer exactly these two times/.test(body)) {
        text = 'Would Saturday at 11:00 AM or Sunday at 11:00 AM suit you for a visit? Free pickup from Yelahanka.';
      } else {
        text = 'Hello! Just checking in about Ashraya. Would you like a site visit this weekend?';
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 20 },
      }));
    });
  });
  return new Promise((resolve) => server.listen(GEMINI_PORT, () => resolve(server)));
}

/* ---------------------------------------------------------- fake WhatsApp */

type Sent = { to: string; type: string; template?: string; text?: string };
const sent: Sent[] = [];

function startMeta(): Promise<Server> {
  let n = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const p = JSON.parse(body);
        sent.push({ to: p.to, type: p.type, template: p.template?.name, text: p.text?.body });
      } catch { /* ignore */ }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ messages: [{ id: `wamid.p6_${++n}_${Date.now()}` }] }));
    });
  });
  return new Promise((resolve) => server.listen(META_PORT, () => resolve(server)));
}

/* ---------------------------------------------------------------- helpers */

const sign = (b: string) =>
  'sha256=' + createHmac('sha256', process.env.WHATSAPP_APP_SECRET!).update(b, 'utf8').digest('hex');

async function buyerSays(phone: string, text: string) {
  const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{
    id: `wamid.p6.in.${Date.now()}.${Math.random()}`, from: phone, type: 'text',
    timestamp: String(Math.floor(Date.now() / 1000)), text: { body: text },
  }] } }] }] });
  await fetch(`${BASE}/api/webhooks/whatsapp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
    body,
  });
  await settle();
}

/** Run the worker until nothing local is running or due. */
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

async function sweep() {
  const r = await fetch(`${BASE}/api/dev/sweep-chases?prefix=${PREFIX}`, {
    method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET! },
  });
  return r.json() as Promise<{ enrolled: { leadId: string; state: string }[]; visitChecks: number }>;
}

/** Bring a lead's pending follow-up work forward to now — "skip to the next step". */
async function nextStep(leadId: string) {
  await sql`update tasks set due_at = now() - interval '1 second'
            where lead_id = ${leadId} and status = 'PENDING'
              and type in ('ADVANCE_CHASE', 'SEND_CHASE_MESSAGE', 'SEND_VISIT_REMINDER')`;
  await settle();
}

async function setAi(base: string | null) {
  const q = base ? `?base=${encodeURIComponent(base)}` : '?restore=1';
  await fetch(`${BASE}/api/dev/break-ai${q}`, {
    method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET! },
  }).catch(() => null);
}

/** A buyer with a backdated history. */
async function makeLead(n: number, opts: {
  status?: string; category?: string | null; optedOut?: boolean; name?: string;
  firstOutboundAgo?: number; inbound?: number[]; // ms ago for each inbound message
} = {}) {
  const phone = `${PREFIX}${String(n).padStart(2, '0')}`;
  await sql`delete from leads where phone = ${phone}`;
  const [lead] = await sql`insert into leads (phone, name, source, status, category, opted_out, wa_state, created_at)
    values (${phone}, ${opts.name ?? 'Test Buyer'}, '99acres', ${opts.status ?? 'MESSAGE_SENT'},
            ${opts.category ?? null}, ${opts.optedOut ?? false}, ${opts.inbound?.length ? 'REPLIED' : 'DELIVERED'},
            now() - interval '20 days')
    returning id, phone`;
  if (opts.firstOutboundAgo !== undefined) {
    await sql`insert into messages (lead_id, direction, body, template_name, wa_message_id, status, sent_at)
      values (${lead.id}, 'outbound', '[template: hello_world]', 'hello_world',
              ${'wamid.p6.first.' + phone + Date.now()}, 'delivered', ${new Date(Date.now() - opts.firstOutboundAgo)})`;
  }
  for (const [i, ago] of (opts.inbound ?? []).entries()) {
    await sql`insert into messages (lead_id, direction, body, wa_message_id, status, sent_at)
      values (${lead.id}, 'inbound', ${'message ' + i}, ${'wamid.p6.old.' + phone + '.' + i + Date.now()},
              'delivered', ${new Date(Date.now() - ago)})`;
  }
  return lead as { id: string; phone: string };
}

async function chase(leadId: string) {
  const [c] = await sql`select * from chase_states where lead_id = ${leadId} order by created_at desc limit 1`;
  return c;
}
async function pendingChaseTasks(leadId: string) {
  const [r] = await sql`select count(*)::int n from tasks where lead_id = ${leadId}
    and status = 'PENDING' and type in ('ADVANCE_CHASE', 'SEND_CHASE_MESSAGE')`;
  return r.n as number;
}
const sentTo = (phone: string) => sent.filter((s) => s.to === phone);

async function clean() {
  await sql`delete from leads where phone like ${PREFIX + '%'}`;
}

/* -------------------------------------------------------------- scenarios */

async function main() {
  await clean();
  await setAi(`http://localhost:${GEMINI_PORT}/v1beta`);

  console.log('\n1. THE ACCEPTANCE TEST — no reply for two days, then he replies');
  {
    const lead = await makeLead(1, { firstOutboundAgo: 2 * DAY + HOUR });
    const report = await sweep();
    const mine = report.enrolled.find((e) => e.leadId === lead.id);
    check('he enters NEVER_ANSWERED', mine?.state === 'NEVER_ANSWERED', JSON.stringify(report.enrolled));

    const c = await chase(lead.id);
    const dueHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(c.next_step_at));
    check('the first follow-up is timed for a decent hour', dueHour >= 9 && dueHour < 21, `${dueHour}:00 IST`);

    const before = sentTo(lead.phone).length;
    await nextStep(lead.id);
    const got = sentTo(lead.phone).slice(before);
    check('...and gets a message', got.length === 1, `${got.length} sent`);
    check('as a template — he never wrote, so WhatsApp allows nothing else', got[0]?.type === 'template',
      JSON.stringify(got[0]));

    await buyerSays(lead.phone, 'Hi, yes I am interested. What is the price?');
    const after = await chase(lead.id);
    check('his reply cancels the chase', after.status === 'CANCELLED', after.status);
    check('with the reason recorded', after.ended_reason === 'he replied', String(after.ended_reason));
    check('and no follow-up tasks are left pending', (await pendingChaseTasks(lead.id)) === 0);
    // His reply sets CHATTING; scoring then runs straight after and, as it
    // always has, moves a scored buyer on to QUALIFIED. Either way he is a live
    // conversation again — what must NOT survive is a "trying to reach him" status.
    const [l] = await sql`select status from leads where id = ${lead.id}`;
    check('he is a live conversation again (CHATTING, or QUALIFIED once scored)',
      ['CHATTING', 'QUALIFIED'].includes(l.status), l.status);
    check('and Meera answered him', sentTo(lead.phone).some((s) => s.type === 'text'));
  }

  console.log('\n2. Chatted, then stopped — WA_GHOST: a message, then a person');
  {
    const lead = await makeLead(2, { status: 'QUALIFIED', firstOutboundAgo: 6 * DAY, inbound: [5 * DAY, 3 * DAY] });
    await sweep();
    check('he enters WA_GHOST', (await chase(lead.id))?.state === 'WA_GHOST');

    await nextStep(lead.id);
    check('step 1: a WhatsApp (a template — his last message was 3 days ago)',
      sentTo(lead.phone).at(-1)?.type === 'template');

    await nextStep(lead.id);
    const calls = await sql`select reason, notes from call_tasks where lead_id = ${lead.id} and status = 'PENDING'`;
    check('step 2: a person is told to ring him', calls.length === 1 && calls[0].reason === 'CHASE',
      JSON.stringify(calls));

    await nextStep(lead.id);   // the three-day wrap-up
    const done = await sql`select state, status from chase_states where lead_id = ${lead.id} order by created_at`;
    check('no reply → the sequence ends as EXHAUSTED', done[0]?.status === 'EXHAUSTED', JSON.stringify(done));
    check('...and he moves to the monthly drip, never deleted', done[1]?.state === 'COLD_DRIP' && done[1]?.status === 'ACTIVE',
      JSON.stringify(done));
    const [l] = await sql`select category from leads where id = ${lead.id}`;
    check('he is marked COLD', l.category === 'COLD', String(l.category));
  }

  console.log('\n3. Missed his visit — NO_SHOW, with the Writer’s own words');
  {
    // He chatted an hour ago, so WhatsApp's 24-hour window is open.
    const lead = await makeLead(3, { status: 'VISIT_BOOKED', firstOutboundAgo: 3 * DAY, inbound: [2 * DAY, 5 * HOUR] });
    await sql`insert into visits (lead_id, visit_at, label, status) values (${lead.id}, now() - interval '2 hours', 'today 11 AM', 'NO_SHOW')`;
    await sweep();
    check('he enters NO_SHOW', (await chase(lead.id))?.state === 'NO_SHOW');

    await nextStep(lead.id);
    const msg = sentTo(lead.phone).at(-1);
    check('step 1: the Writer’s own words, not a template — the window is open', msg?.type === 'text', JSON.stringify(msg));

    await nextStep(lead.id);
    const [call] = await sql`select reason from call_tasks where lead_id = ${lead.id} and status = 'PENDING'`;
    check('step 2: a call to rebook', call?.reason === 'NO_SHOW', String(call?.reason));

    await sql`update call_tasks set status = 'DONE' where lead_id = ${lead.id}`;
    await nextStep(lead.id);
    const offer = sentTo(lead.phone).at(-1);
    check('step 3: he is offered new visit times', /11:00 AM/.test(String(offer?.text)), String(offer?.text));
  }

  console.log('\n4. The Writer invents a price — code catches it');
  {
    const lead = await makeLead(4, { status: 'QUALIFIED', firstOutboundAgo: 3 * DAY, inbound: [3 * HOUR] });
    await sql`insert into visits (lead_id, visit_at, status) values (${lead.id}, now() - interval '1 hour', 'NO_SHOW')`;
    gemini.inventPrice = true;
    await sweep();
    await nextStep(lead.id);
    gemini.inventPrice = false;
    const msg = sentTo(lead.phone).at(-1);
    check('the invented ₹39 lakh never reaches him', !/39/.test(String(msg?.text)), String(msg?.text));
    check('the safe pre-written message went instead', /we missed you/i.test(String(msg?.text)), String(msg?.text));
  }

  console.log('\n5. The other sequences start for the right people');
  {
    const visited = await makeLead(5, { status: 'VISITED', firstOutboundAgo: 8 * DAY, inbound: [7 * DAY, 3 * DAY] });
    await sql`insert into visits (lead_id, visit_at, status) values (${visited.id}, now() - interval '30 hours', 'ATTENDED')`;

    const hot = await makeLead(6, { status: 'WITH_AGENT', category: 'HOT', firstOutboundAgo: 5 * DAY, inbound: [4 * DAY, 26 * HOUR] });

    const ghost = await makeLead(7, { status: 'QUALIFIED', firstOutboundAgo: 9 * DAY, inbound: [8 * DAY] });
    await sql`insert into touches (lead_id, channel, direction, outcome, happened_at) values
      (${ghost.id}, 'call', 'outbound', 'ANSWERED', now() - interval '6 days'),
      (${ghost.id}, 'call', 'outbound', 'NO_ANSWER', now() - interval '4 days'),
      (${ghost.id}, 'call', 'outbound', 'BUSY', now() - interval '3 days')`;

    await sweep();
    check('visited, quiet a day → POST_VISIT_SILENT', (await chase(visited.id))?.state === 'POST_VISIT_SILENT');
    check('HOT and quiet a day → LATE_STAGE', (await chase(hot.id))?.state === 'LATE_STAGE');
    check('picked up once, then missed two calls → CALL_GHOST', (await chase(ghost.id))?.state === 'CALL_GHOST');

    await nextStep(hot.id);
    const [call] = await sql`select reason, priority, agent_id from call_tasks where lead_id = ${hot.id} and status = 'PENDING'`;
    check('LATE_STAGE: a call at the top of the queue', call?.reason === 'LATE_STAGE' && call?.priority >= 10,
      JSON.stringify(call));
    const [owned] = await sql`select owner_agent_id from leads where id = ${hot.id}`;
    check('...owned by an agent', Boolean(owned.owner_agent_id) && call?.agent_id === owned.owner_agent_id);
  }

  console.log('\n6. Who is never chased');
  {
    const optedOut = await makeLead(10, { optedOut: true, firstOutboundAgo: 5 * DAY });
    const lost = await makeLead(11, { status: 'LOST', firstOutboundAgo: 5 * DAY });
    const coming = await makeLead(12, { status: 'VISIT_BOOKED', firstOutboundAgo: 5 * DAY, inbound: [4 * DAY] });
    await sql`insert into visits (lead_id, visit_at, status) values (${coming.id}, now() + interval '2 days', 'BOOKED')`;
    const fresh = await makeLead(13, { firstOutboundAgo: 20 * HOUR });

    await sweep();
    for (const [label, l] of [['said STOP', optedOut], ['already LOST', lost],
      ['has a visit coming up', coming], ['first message was only yesterday', fresh]] as const) {
      check(`not chased: ${label}`, !(await chase(l.id)), 'was enrolled');
    }

    const again = await sweep();
    const [dupes] = await sql`select lead_id, count(*)::int n from chase_states where status = 'ACTIVE'
      and lead_id in (select id from leads where phone like ${PREFIX + '%'}) group by lead_id having count(*) > 1`;
    check('sweeping twice never starts two sequences for one buyer', !dupes, JSON.stringify(dupes));
    void again;
  }

  console.log('\n7. Stops the moment he picks up the phone');
  {
    const lead = await makeLead(14, { status: 'QUALIFIED', firstOutboundAgo: 6 * DAY, inbound: [3 * DAY] });
    await sweep();
    await nextStep(lead.id);
    await sql`insert into touches (lead_id, channel, direction, outcome, happened_at)
              values (${lead.id}, 'call', 'outbound', 'ANSWERED', now())`;
    const before = sentTo(lead.phone).length;
    await nextStep(lead.id);
    const c = await chase(lead.id);
    check('the sequence stops', c.status === 'CANCELLED', `${c.status} (${c.ended_reason})`);
    check('and nothing more is sent', sentTo(lead.phone).length === before);
  }

  console.log('\n8. Visit reminders');
  {
    const lead = await makeLead(15, { status: 'CHATTING', firstOutboundAgo: 2 * DAY, inbound: [DAY] });
    const inThreeDays = (h: number) => {
      const d = new Date(Date.now() + 3 * DAY + 330 * 60_000);
      return `${d.toISOString().slice(0, 10)}T${h}:00:00+05:30`;
    };
    gemini.reader = { language: 'english', summary: 'Booking.', visit_agreed: true,
      visit_datetime_iso: inThreeDays(11), visit_label: 'in three days at 11 AM' };
    await buyerSays(lead.phone, 'I will come on that day at 11 AM');
    const [v] = await sql`select id, visit_at from visits where lead_id = ${lead.id}`;
    const [r] = await sql`select due_at from tasks where lead_id = ${lead.id} and type = 'SEND_VISIT_REMINDER'`;
    check('booking a visit queues a reminder', Boolean(r), 'none');
    check('for a day before the visit', r && Math.abs(new Date(v.visit_at).getTime() - DAY - new Date(r.due_at).getTime()) < 60_000,
      r ? `${new Date(r.due_at).toISOString()} vs visit ${new Date(v.visit_at).toISOString()}` : '');

    // He moves it before the reminder goes.
    gemini.reader = { ...gemini.reader, visit_datetime_iso: inThreeDays(16), visit_label: 'in three days at 4 PM' };
    await buyerSays(lead.phone, 'Actually make it 4 PM');
    const reminders = await sql`select payload->>'visitAt' as at from tasks
      where lead_id = ${lead.id} and type = 'SEND_VISIT_REMINDER' order by created_at`;
    check('moving the visit queues a fresh reminder', reminders.length === 2, `${reminders.length} reminders`);

    const before = sentTo(lead.phone).length;
    await nextStep(lead.id);
    const reminded = sentTo(lead.phone).slice(before).filter((s) => /reminder of your site visit/.test(String(s.text)));
    check('only ONE reminder reaches him — for the new time', reminded.length === 1, `${reminded.length} sent`);
    check('it says 4:00 PM, not 11', /4:00 PM/.test(String(reminded[0]?.text)), String(reminded[0]?.text).slice(0, 120));
    check('it carries the map link', /maps\.google/.test(String(reminded[0]?.text)));
    gemini.reader = { language: 'english', summary: 'Test buyer.', visit_agreed: false };
  }

  console.log('\n9. A passed visit nobody marked — someone is asked');
  {
    const lead = await makeLead(16, { status: 'VISIT_BOOKED', firstOutboundAgo: 4 * DAY, inbound: [3 * DAY] });
    await sql`insert into visits (lead_id, visit_at, status) values (${lead.id}, now() - interval '4 hours', 'BOOKED')`;
    await sweep();
    const [call] = await sql`select reason from call_tasks where lead_id = ${lead.id} and status = 'PENDING'`;
    check('a "did he come?" call is queued', call?.reason === 'VISIT_CHECK', String(call?.reason));
    check('and he is not chased as if he had vanished', !(await chase(lead.id)));
  }

  // Let background work finish before deleting the test leads.
  await settle();
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
  await setAi(null);
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
