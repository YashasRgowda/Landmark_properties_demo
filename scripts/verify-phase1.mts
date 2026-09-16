/**
 * Phase 1 acceptance test.
 *
 *   npm run verify:phase1
 *
 * Requires the dev server running (npm run dev). Uses a throwaway phone number
 * and deletes it afterwards, so it is safe to run against real data.
 */
import postgres from 'postgres';

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000';
const PHONE_LOCAL = '9000000001'; // reserved for this test
const CANONICAL = '919000000001';

let passed = 0;
let failed = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? '' : `  — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
  if (ok) passed++;
  else failed++;
}

// `null` means send no secret header at all. A default parameter would not do:
// JavaScript applies defaults on `undefined`, so passing undefined would
// silently send the real secret and make the auth check look like it passed.
async function post(body: unknown, secret: string | null = process.env.LEAD_WEBHOOK_SECRET ?? null) {
  const res = await fetch(`${BASE}/api/leads/intake`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret ? { 'x-webhook-secret': secret } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

  // Start clean.
  await sql`delete from leads where phone = ${CANONICAL}`;

  console.log('\nAuth');
  check('no secret is rejected', (await post({ phone: PHONE_LOCAL, source: '99acres' }, null)).status, 401);
  check('wrong secret is rejected', (await post({ phone: PHONE_LOCAL, source: '99acres' }, 'wrong')).status, 401);

  console.log('\nValidation');
  check('unusable phone is rejected', (await post({ phone: '12345', source: '99acres' })).status, 400);
  check('missing source is rejected', (await post({ phone: PHONE_LOCAL })).status, 400);
  check('non-JSON body is rejected', (await post('garbage')).status, 400);

  console.log('\nDedupe — the same number in three formats');
  const a = await post({ phone: `+91 ${PHONE_LOCAL.slice(0, 5)} ${PHONE_LOCAL.slice(5)}`, source: '99Acres', name: 'Test Buyer' });
  check('first POST creates the lead (201)', a.status, 201);
  check('phone stored canonically', a.json.phone, CANONICAL);

  const b = await post({ phone: `0${PHONE_LOCAL}`, source: 'Magic Bricks', name: 'Different Name' });
  check('second POST is a duplicate (200)', b.status, 200);
  check('same lead id', b.json.leadId, a.json.leadId);

  const c = await post({ phone: PHONE_LOCAL, source: 'housing.com' });
  check('third POST is a duplicate (200)', c.status, 200);
  check('same lead id', c.json.leadId, a.json.leadId);

  console.log('\nDatabase');
  const rows = await sql`select id, name, source from leads where phone = ${CANONICAL}`;
  check('exactly one lead row', rows.length, 1);
  check('acquisition source kept as the first one', rows[0]?.source, '99acres');
  check('existing name not overwritten', rows[0]?.name, 'Test Buyer');

  const t = await sql`select count(*)::int as n from touches where lead_id = ${rows[0]?.id}`;
  check('three touches, one per enquiry', t[0].n, 3);

  console.log('\nConcurrency — 10 simultaneous enquiries for one new number');
  await sql`delete from leads where phone = ${CANONICAL}`;
  await Promise.all(
    Array.from({ length: 10 }, () => post({ phone: PHONE_LOCAL, source: '99acres' })),
  );
  const race = await sql`select id from leads where phone = ${CANONICAL}`;
  check('still exactly one lead', race.length, 1);
  const rt = await sql`select count(*)::int as n from touches where lead_id = ${race[0]?.id}`;
  check('ten touches', rt[0].n, 10);

  // Clean up.
  await sql`delete from leads where phone = ${CANONICAL}`;
  await sql.end();

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\nverify failed to run:', e.message);
  console.error('Is the dev server running? (npm run dev)');
  process.exit(1);
});
