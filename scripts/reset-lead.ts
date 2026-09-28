/**
 * Wipe a lead so the system meets them as a stranger again.
 *
 *   npm run lead:reset                     # show every lead, delete nothing
 *   npm run lead:reset -- 918095762180     # show what would go, delete nothing
 *   npm run lead:reset -- 918095762180 --yes
 *   npm run lead:reset -- --tests --yes    # every reserved test number
 *
 * Deleting the lead cascades to its messages, touches, tasks, visits, chase
 * states and call tasks, so the next message starts a genuinely fresh
 * conversation — Meera has no history and no booked visit to refer back to.
 *
 * Nothing is deleted without --yes. This talks to the live database.
 */
import postgres from 'postgres';
import { normalisePhone } from '../lib/phone';

/** Numbers the verify scripts and simulators reserve for themselves. */
const TEST_PREFIXES = ['91900000'];

async function main() {
  const args = process.argv.slice(2);
  const confirmed = args.includes('--yes');
  const testsOnly = args.includes('--tests');
  const rawPhone = args.find((a) => !a.startsWith('--'));

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Fill it in .env.local first.');
    process.exit(1);
  }

  const sql = postgres(process.env.DATABASE_URL, { max: 2, prepare: false });

  const targets = testsOnly
    ? await sql`select id, phone, name, status from leads
                where phone like ${TEST_PREFIXES[0] + '%'} order by phone`
    : rawPhone
      ? await sql`select id, phone, name, status from leads where phone = ${normalisePhone(rawPhone) ?? rawPhone}`
      : await sql`select id, phone, name, status from leads order by created_at desc`;

  if (targets.length === 0) {
    console.log(rawPhone ? `No lead found for ${rawPhone}.` : 'No leads in the database.');
    await sql.end();
    return;
  }

  if (!rawPhone && !testsOnly) {
    console.log(`${targets.length} lead(s) in the database:\n`);
    for (const t of targets) {
      console.log(`  ${t.phone}  ${String(t.name ?? '—').padEnd(20)} ${t.status}`);
    }
    console.log('\nReset one with:  npm run lead:reset -- <phone> --yes');
    await sql.end();
    return;
  }

  console.log(`${confirmed ? 'Deleting' : 'Would delete'} ${targets.length} lead(s):\n`);
  for (const t of targets) {
    const [counts] = await sql`
      select (select count(*)::int from messages   where lead_id = ${t.id}) as messages,
             (select count(*)::int from touches    where lead_id = ${t.id}) as touches,
             (select count(*)::int from tasks      where lead_id = ${t.id}) as tasks,
             (select count(*)::int from visits     where lead_id = ${t.id}) as visits,
             (select count(*)::int from call_tasks where lead_id = ${t.id}) as calls`;
    console.log(`  ${t.phone}  ${String(t.name ?? '—').padEnd(20)} ${t.status}`);
    console.log(`     ${counts.messages} messages · ${counts.touches} touches · ` +
      `${counts.tasks} tasks · ${counts.visits} visits · ${counts.calls} calls`);
  }

  if (!confirmed) {
    console.log('\nNothing was deleted. Add --yes to go ahead.');
    await sql.end();
    return;
  }

  for (const t of targets) await sql`delete from leads where id = ${t.id}`;
  console.log(`\nDone. ${targets.length} lead(s) deleted — the next message starts fresh.`);
  await sql.end();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
