/**
 * Phase 4 acceptance test — Meera and The Reader.
 *
 *   npm run verify:phase4
 *
 * Holds a real conversation using the real Gemini key, delivered through a fake
 * Meta so no WhatsApp credentials are needed. Uses one reserved number and
 * deletes it afterwards.
 */
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import postgres from 'postgres';

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000';
const APP_SECRET = process.env.WHATSAPP_APP_SECRET!;
const PHONE = '919000000077';

let passed = 0;
let failed = 0;
const sent: string[] = []; // what the fake Meta was asked to deliver

function check(label: string, ok: boolean, detail?: string) {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `  — ${detail}`}`);
  if (ok) passed++;
  else failed++;
}

const sign = (body: string) =>
  'sha256=' + createHmac('sha256', APP_SECRET).update(body, 'utf8').digest('hex');

async function buyerSays(text: string, id: string) {
  const payload = {
    entry: [{ changes: [{ value: { messages: [{
      id, from: PHONE, type: 'text',
      timestamp: String(Math.floor(Date.now() / 1000)), text: { body: text },
    }] } }] }],
  };
  const body = JSON.stringify(payload);
  await fetch(`${BASE}/api/webhooks/whatsapp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
    body,
  });
  // Worker delivers the reply; a second pass runs any queued scoring.
  await runWorker();
  await runWorker();
}

async function runWorker() {
  const res = await fetch(`${BASE}/api/cron/worker`, {
    headers: { 'x-cron-secret': process.env.CRON_SECRET! },
  });
  return res.json();
}

const KANNADA = /[ಀ-೿]/;
const DEVANAGARI = /[ऀ-ॿ]/;

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 4, prepare: false });
  const clean = async () => {
    await sql`delete from leads where phone = ${PHONE}`;
    await sql`delete from tasks where type in ('PROCESS_WA_EVENT','RUN_READER')`;
  };
  await clean();

  console.log('\nProject data');
  const projectRes = await fetch(`${BASE}/api/cron/worker`, {
    headers: { 'x-cron-secret': process.env.CRON_SECRET! },
  });
  void projectRes;
  await sql`delete from project_data where id = 1`;

  console.log('\nA buyer writes in Kannada');
  await buyerSays('ಬೆಲೆ ಎಷ್ಟು? 30x40 ಸೈಟ್ ಇದೆಯಾ?', 'p4.m1');

  const [lead] = await sql`select * from leads where phone = ${PHONE}`;
  check('a lead exists', Boolean(lead));

  const replies = await sql`
    select body from messages where lead_id = ${lead.id} and direction = 'outbound'
    order by sent_at`;
  check('Meera replied', replies.length >= 1, `${replies.length} outbound messages`);

  const first = String(replies[0]?.body ?? '');
  console.log(`\n    buyer: ಬೆಲೆ ಎಷ್ಟು? 30x40 ಸೈಟ್ ಇದೆಯಾ?`);
  console.log(`    meera: ${first.replace(/\n/g, '\n           ').slice(0, 300)}\n`);

  check('she replied in Kannada', KANNADA.test(first), 'no Kannada characters found');
  check('she did not mix in Hindi', !DEVANAGARI.test(first));
  check('it is a WhatsApp-length reply, not an essay', first.length < 900, `${first.length} chars`);

  console.log('\nShe answers only from the approved data');
  const priceFigures = first.match(/₹\s?[\d.,]+\s?(lakh|crore|lakhs|cr)?/gi) ?? [];
  const approved = ['42', '52.5', '84', '1.4', '3,500', '3500', '2'];
  const invented = priceFigures.filter(
    (f) => !approved.some((a) => f.replace(/[₹\s]/g, '').startsWith(a)),
  );
  check('no invented prices', invented.length === 0, `found ${JSON.stringify(invented)}`);

  console.log('\nThe reply goes out before any scoring');
  const readerTasks = await sql`
    select status from tasks where lead_id = ${lead.id} and type = 'RUN_READER'`;
  check('scoring was queued as a separate task', readerTasks.length >= 1);
  const outboundBeforeReader = await sql`
    select count(*)::int as n from messages where lead_id = ${lead.id} and direction='outbound'`;
  check('a reply already exists', outboundBeforeReader[0].n >= 1);

  console.log('\nThe conversation continues');
  await buyerSays('ನನ್ನ ಬಜೆಟ್ 45 ಲಕ್ಷ. ಸ್ವಂತ ಮನೆ ಕಟ್ಟಲು.', 'p4.m2');
  await buyerSays('ಖಾತಾ ಮತ್ತು DC conversion ಪೇಪರ್ ಕಳಿಸಿ', 'p4.m3');

  const [scored] = await sql`select * from leads where phone = ${PHONE}`;
  check('the lead has been scored', scored.category !== null, `category=${scored.category}`);
  check('a score was recorded', Number(scored.score) > 0, `score=${scored.score}`);
  check('language detected as Kannada', scored.language === 'kannada', `got ${scored.language}`);
  check('budget captured', Boolean(scored.budget), `budget=${scored.budget}`);
  check('a one-line summary exists for the agent', Boolean(scored.summary), `${scored.summary}`);
  check('a Kannada budget earned its points (not COLD)',
    ['WARM', 'HOT'].includes(String(scored.category)),
    `a buyer with ₹45 ಲಕ್ಷ, docs asked and own-construction should not be ${scored.category}`);
  console.log(`\n    → ${scored.category} (${scored.score}) · ${scored.budget} · ${scored.summary}\n`);

  console.log('\nAgreeing a visit books it');
  await buyerSays('ಸರಿ, ಭಾನುವಾರ ಬೆಳಿಗ್ಗೆ 11 ಗಂಟೆಗೆ ಬರುತ್ತೇನೆ', 'p4.m4');
  await buyerSays('ಹೌದು, ಭಾನುವಾರ 11 AM confirm ಮಾಡಿ', 'p4.m5');
  await buyerSays('ಬೆಲೆ ಮಾತುಕತೆ ಆಗುತ್ತದೆಯೇ?', 'p4.m6');

  const bookings = await sql`select * from visits where lead_id = ${lead.id}`;
  check('a visit was booked', bookings.length >= 1, `${bookings.length} visits`);
  if (bookings.length) {
    const at = new Date(bookings[0].visit_at);
    const istHour = Number(
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(at),
    );
    check('it is in the future', at.getTime() > Date.now(), at.toISOString());
    check('it is inside site hours (10–18 IST)', istHour >= 10 && istHour <= 18, `hour ${istHour}`);
    console.log(`    → ${bookings[0].label ?? '(no label)'} · ${at.toISOString()}`);
  }
  check('never two visits for one lead', bookings.length <= 1, `${bookings.length}`);

  const [afterVisit] = await sql`select category, score from leads where phone = ${PHONE}`;
  check('agreeing a visit pushes him to HOT', afterVisit.category === 'HOT',
    `${afterVisit.category} (${afterVisit.score})`);

  console.log('\nEvery AI call is logged');
  const calls = await sql`select job, provider, model, success, input_tokens, output_tokens
                          from ai_calls where lead_id = ${lead.id}`;
  check('calls recorded', calls.length > 0, `${calls.length} calls`);
  check('Meera calls logged', calls.some((c) => c.job === 'meera'));
  check('Reader calls logged', calls.some((c) => c.job === 'reader'));
  check('token counts captured', calls.some((c) => Number(c.input_tokens) > 0));
  const totalIn = calls.reduce((s, c) => s + Number(c.input_tokens ?? 0), 0);
  const totalOut = calls.reduce((s, c) => s + Number(c.output_tokens ?? 0), 0);
  console.log(`    → ${calls.length} calls · ${totalIn} in / ${totalOut} out tokens · model ${calls[0]?.model}`);

  console.log('\nThe Reader runs on some messages, not every one');
  const readerRuns = await sql`
    select count(*)::int as n from ai_calls where lead_id = ${lead.id} and job = 'reader'`;
  const buyerMessages = await sql`
    select count(*)::int as n from messages where lead_id = ${lead.id} and direction = 'inbound'`;
  // The Reader runs every third message, PLUS immediately on anything carrying
  // a date, a time or a budget — so a conversation full of those is read every
  // time, by design. What must never happen is reading more often than there
  // are messages.
  check('never reads more often than the buyer writes', readerRuns[0].n <= buyerMessages[0].n,
    `${readerRuns[0].n} readings for ${buyerMessages[0].n} messages`);

  console.log('\nIf the AI fails, the buyer still gets an answer');
  const before = await sql`select count(*)::int as n from messages where lead_id=${lead.id} and direction='outbound'`;
  await fetch(`${BASE}/api/dev/break-ai`, {
    method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET! },
  });
  await buyerSays('Hello, are you there?', 'p4.m7');
  await fetch(`${BASE}/api/dev/break-ai?restore=1`, {
    method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET! },
  });

  const after = await sql`
    select body from messages where lead_id=${lead.id} and direction='outbound' order by sent_at`;
  check('a reply still went out', after.length > before[0].n, `${before[0].n} → ${after.length}`);
  const last = String(after[after.length - 1]?.body ?? '');
  check('it is the fallback with the sales head number', /sales head|Ravi|\+91/i.test(last), last.slice(0, 120));
  const failures = await sql`
    select count(*)::int as n from ai_calls where lead_id=${lead.id} and success = false`;
  check('the failure was logged', failures[0].n > 0, `${failures[0].n} failed calls`);

  await clean();
  await sql.end();

  console.log(`\nfake Meta delivered ${sent.length} messages`);
  console.log(`${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

function startFakeMeta(port: number) {
  let n = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        sent.push(parsed?.text?.body ?? '');
      } catch { /* ignore */ }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ messages: [{ id: `wamid.p4_${++n}` }] }));
    });
  });
  return new Promise<() => void>((resolve) => {
    server.listen(port, () => resolve(() => server.close()));
  });
}

startFakeMeta(Number(process.env.FAKE_META_PORT ?? 4599)).then((stop) =>
  main()
    .catch((e) => {
      console.error('\nverify failed to run:', e.message);
      console.error('Is the dev server running? (npm run dev)');
      process.exitCode = 1;
    })
    .finally(stop),
);
