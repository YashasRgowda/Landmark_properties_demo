/**
 * Add or update a sales agent — a person leads get handed to.
 *
 *   npm run agent:create -- "Ravi Kumar" kannada,english "+91 98450 00000"
 *
 * An agent is not a login account. `users` is who can sign in; `agents` is who
 * a hot lead is assigned to and whose name appears on the call queue. The two
 * are deliberately separate, and Phase 7 replaces this script with a screen.
 */
import postgres from 'postgres';

async function main() {
  const [nameArg, languagesArg, phoneArg, emailArg] = process.argv.slice(2);
  const name = (nameArg ?? '').trim();
  const languages = (languagesArg ?? 'english')
    .split(',')
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean);

  if (!name) {
    console.error('Usage: npm run agent:create -- "<name>" [languages] [phone] [email]');
    console.error('   eg: npm run agent:create -- "Ravi Kumar" kannada,english "+91 98450 00000"');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Fill it in .env.local first.');
    process.exit(1);
  }

  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });

  // Email is the natural key when given; otherwise match on the name so running
  // this twice updates the same person rather than making a duplicate.
  const email = (emailArg ?? '').trim().toLowerCase() || null;
  const phone = (phoneArg ?? '').trim() || null;

  const existing = email
    ? await sql`select id from agents where email = ${email}`
    : await sql`select id from agents where name = ${name}`;

  if (existing.length > 0) {
    await sql`update agents set name = ${name}, languages = ${languages},
              phone = ${phone}, active = true where id = ${existing[0].id}`;
    console.log(`Updated agent "${name}" — speaks ${languages.join(', ')}`);
  } else {
    await sql`insert into agents (name, email, phone, languages, active)
              values (${name}, ${email}, ${phone}, ${languages}, true)`;
    console.log(`Added agent "${name}" — speaks ${languages.join(', ')}`);
  }

  const all = await sql`select name, languages, active from agents order by name`;
  console.log(`\n${all.length} agent(s):`);
  for (const a of all) {
    console.log(`  ${a.active ? '●' : '○'} ${a.name} — ${(a.languages as string[]).join(', ')}`);
  }

  await sql.end();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
