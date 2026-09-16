/**
 * Create or update a login account.
 *
 *   npm run user:create -- admin@landmark.test 'a-strong-password' admin
 *
 * Passwords are read from argv for convenience in development. For anything
 * real, pass it via an environment variable instead so it stays out of the
 * shell history:  USER_PASSWORD=... npm run user:create -- me@x.com '' admin
 */
import bcrypt from 'bcryptjs';
import postgres from 'postgres';

async function main() {
  const [emailArg, passwordArg, roleArg] = process.argv.slice(2);
  const email = (emailArg ?? '').trim().toLowerCase();
  const password = process.env.USER_PASSWORD || passwordArg || '';
  const role = roleArg === 'agent' ? 'agent' : 'admin';

  if (!email || !password) {
    console.error("Usage: npm run user:create -- <email> <password> [admin|agent]");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Fill it in .env.local first.');
    process.exit(1);
  }

  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
  const hash = await bcrypt.hash(password, 12);

  await sql`
    insert into users (email, password_hash, role, active)
    values (${email}, ${hash}, ${role}, true)
    on conflict (email) do update
      set password_hash = excluded.password_hash,
          role          = excluded.role,
          active        = true
  `;

  await sql.end();
  console.log(`✓ ${email} can now sign in as ${role}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
