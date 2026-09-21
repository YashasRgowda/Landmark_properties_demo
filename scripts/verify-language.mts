/**
 * Language acceptance test — the full sweep.
 *
 *   npm run verify:language
 *
 * Drives the real WhatsApp path (webhook → worker → Meera) through a fake Meta,
 * in ONE long conversation that switches language constantly — the condition
 * that broke every earlier version. Uses a reserved number and cleans up.
 */
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import postgres from 'postgres';
import { detectLanguage, scriptsIn } from '../lib/ai/language';

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000';
const PHONE = '919000000033';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `  — ${detail}`}`);
  if (ok) passed++;
  else {
    failed++;
    failures.push(`${label} — ${detail}`);
  }
}

const sign = (b: string) =>
  'sha256=' + createHmac('sha256', process.env.WHATSAPP_APP_SECRET!).update(b, 'utf8').digest('hex');

async function say(text: string, i: number): Promise<string> {
  const body = JSON.stringify({
    entry: [{ changes: [{ value: { messages: [{
      id: `lang.${i}.${Date.now()}`, from: PHONE, type: 'text',
      timestamp: String(Math.floor(Date.now() / 1000)), text: { body: text },
    }] } }] }],
  });
  await fetch(`${BASE}/api/webhooks/whatsapp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
    body,
  });
  for (let k = 0; k < 2; k++) {
    await fetch(`${BASE}/api/cron/worker`, { headers: { 'x-cron-secret': process.env.CRON_SECRET! } });
  }
  return '';
}

type Turn = {
  group: string;
  text: string;
  expect: 'kannada' | 'hindi' | 'telugu' | 'tamil' | 'english';
  /** Words the reply must contain. */
  must?: string[];
  /** Words the reply must NOT contain. */
  mustNot?: string[];
};

/** One unbroken conversation. Nothing is reset — that is the point. */
const TURNS: Turn[] = [
  // Each language, cold
  { group: 'Each language', text: 'ಬೆಲೆ ಎಷ್ಟು? 30x40 ಸೈಟ್ ಇದೆಯಾ?', expect: 'kannada', must: ['42'] },
  { group: 'Each language', text: 'रेट क्या है?', expect: 'hindi', must: ['3,500'] },
  { group: 'Each language', text: 'ధర ఎంత?', expect: 'telugu', must: ['3,500'] },
  { group: 'Each language', text: 'விலை என்ன?', expect: 'tamil', must: ['3,500'] },
  { group: 'Each language', text: 'What is the rate?', expect: 'english', must: ['3,500'] },

  // Switching mid-chat
  { group: 'Switching', text: 'ಖಾತಾ ಇದೆಯಾ?', expect: 'kannada' },
  { group: 'Switching', text: 'ఖాతా ఉందా?', expect: 'telugu' },
  { group: 'Switching', text: 'खाता है क्या?', expect: 'hindi' },
  { group: 'Switching', text: 'கதா இருக்கா?', expect: 'tamil' },

  // Telugu / Kannada ping-pong — the confusable pair
  { group: 'Confusable pair', text: 'ధర ఎంత?', expect: 'telugu' },
  { group: 'Confusable pair', text: 'ಬೆಲೆ ಎಷ್ಟು?', expect: 'kannada' },
  { group: 'Confusable pair', text: 'ధర ఎంత?', expect: 'telugu' },
  { group: 'Confusable pair', text: 'ಬೆಲೆ ಎಷ್ಟು?', expect: 'kannada' },

  // Romanised input must get an English reply
  { group: 'Romanised', text: 'bele estu? site ideya?', expect: 'english' },
  { group: 'Romanised', text: 'rate kitna hai bhai', expect: 'english' },

  // Buyer mixes scripts himself — reply must still be single-script
  { group: 'Mixed input', text: 'ಬೆಲೆ ಎಷ್ಟು? price in lakhs please', expect: 'kannada' },

  // Facts must survive translation
  { group: 'Facts', text: 'ಎಷ್ಟು 30x40 ಸೈಟ್ ಬಾಕಿ ಇದೆ?', expect: 'kannada', must: ['14'] },
  { group: 'Facts', text: 'సర్వే నంబర్ ఏంటి?', expect: 'telugu', must: ['148'] },
  // "Which town?" — Yelahanka is the town, Rajanukunte the village. Either is
  // a correct answer, so require the town and check only that neither name is
  // translated into another script.
  { group: 'Facts', text: 'ಯಾವ ಊರಿನಲ್ಲಿ ಇದೆ?', expect: 'kannada', must: ['Yelahanka'] },

  // Rules must hold in every language
  { group: 'Rules', text: 'EMI ఎంత అవుతుంది? 15 సంవత్సరాలకు', expect: 'telugu', mustNot: ['EMI will be', 'per month ₹'] },
  { group: 'Rules', text: '20% ಡಿಸ್ಕೌಂಟ್ ಕೊಡಿ', expect: 'kannada', mustNot: ['20%'] },

  // Endurance — deep into a long chat
  { group: 'Endurance', text: 'ಸೈಟ್ ವಿಸಿಟ್ ಯಾವಾಗ?', expect: 'kannada' },
  { group: 'Endurance', text: 'ధర తగ్గిస్తారా?', expect: 'telugu' },
  { group: 'Endurance', text: 'साइट विजिट कब कर सकते हैं?', expect: 'hindi' },
  { group: 'Endurance', text: 'ஆதிவாரம் வரலாமா?', expect: 'tamil' },
  { group: 'Endurance', text: 'ಭಾನುವಾರ ಬೆಳಿಗ್ಗೆ 11 ಗಂಟೆಗೆ ಬರುತ್ತೇನೆ', expect: 'kannada' },
];

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });
  await sql`delete from leads where phone = ${PHONE}`;
  await sql`insert into leads (phone, source, status, wa_state)
            values (${PHONE}, 'website', 'CHATTING', 'REPLIED')`;

  let group = '';
  for (const [i, turn] of TURNS.entries()) {
    if (turn.group !== group) {
      group = turn.group;
      console.log(`\n${group}`);
    }

    const before = await sql`select count(*)::int as n from messages
      where lead_id = (select id from leads where phone=${PHONE}) and direction='outbound'`;
    await say(turn.text, i);
    const out = await sql`select body from messages
      where lead_id = (select id from leads where phone=${PHONE}) and direction='outbound'
      order by sent_at`;

    const reply = String(out[out.length - 1]?.body ?? '');
    const replied = out.length > before[0].n;
    const found = scriptsIn(reply);
    const fellBack = reply.includes('Our sales head');

    const rightScript =
      turn.expect === 'english' ? found.length === 0 : found.includes(turn.expect);
    const single = found.length <= 1;
    const missing = (turn.must ?? []).filter((w) => !reply.includes(w));
    const banned = (turn.mustNot ?? []).filter((w) => reply.includes(w));
    const spelledOut = /\b(forty[- ]two|thirty[- ]five hundred|forty two lakh)\b/i.test(reply);

    const ok =
      replied && rightScript && single && !fellBack && missing.length === 0 &&
      banned.length === 0 && !spelledOut;

    const why = [
      !replied && 'no reply',
      fellBack && 'FELL BACK to the canned message',
      !rightScript && `wanted ${turn.expect}, got [${found.join(',') || 'latin'}]`,
      !single && `mixed scripts [${found.join(',')}]`,
      missing.length > 0 && `missing ${missing.join(', ')}`,
      banned.length > 0 && `said ${banned.join(', ')}`,
      spelledOut && 'spelled a number out in words',
    ].filter(Boolean).join('; ');

    check(`${turn.expect.padEnd(7)} "${turn.text.slice(0, 26)}"`, ok, why);
    if (!ok) console.log(`        reply: ${reply.replace(/\n+/g, ' / ').slice(0, 150)}`);
  }

  // Whole-conversation checks
  console.log('\nAcross the whole conversation');
  const all = await sql`select body, direction from messages
    where lead_id = (select id from leads where phone=${PHONE}) order by sent_at`;
  const replies = all.filter((m) => m.direction === 'outbound').map((m) => String(m.body));

  check('every message got a reply', replies.length === TURNS.length,
    `${replies.length} replies for ${TURNS.length} messages`);
  check('no reply mixed two scripts', replies.every((r) => scriptsIn(r).length <= 1));
  check('no foreign script ever appeared',
    replies.every((r) => !scriptsIn(r).some((s) =>
      !['kannada', 'telugu', 'hindi', 'tamil'].includes(s))));
  check('the canned fallback was never used',
    replies.every((r) => !r.includes('Our sales head')));
  check('the buyer was never sent an error',
    replies.every((r) => !/error|undefined|null|exception/i.test(r)));
  check('every reply detects as a language we support',
    replies.every((r) => ['english', 'kannada', 'telugu', 'hindi', 'tamil']
      .includes(detectLanguage(r))));

  const models = await sql`select model, count(*)::int as n from ai_calls
    where created_at > now() - interval '30 minutes' group by model order by n desc`;
  console.log('\nmodels and keys used:', models.map((m) => `${m.model} x${m.n}`).join(', '));

  await sql`delete from leads where phone = ${PHONE}`;
  await sql.end();

  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  · ${f}`);
  }
  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

const fakeMeta = createServer((req, res) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ messages: [{ id: `wamid.lang${Date.now()}${Math.random()}` }] }));
  });
});

fakeMeta.listen(Number(process.env.FAKE_META_PORT ?? 4599), () =>
  main()
    .catch((e) => {
      console.error('\nverify failed to run:', e.message);
      console.error('Is the dev server running? (npm run dev)');
      process.exitCode = 1;
    })
    .finally(() => fakeMeta.close()),
);
