import 'server-only';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

type Db = ReturnType<typeof drizzle<typeof schema>>;

/**
 * One postgres pool per process, created on first use — not at import time, so
 * a build (or a page that never touches the database) does not need
 * DATABASE_URL. Next re-evaluates modules on every dev change, so the pool is
 * cached on globalThis to avoid leaking connections.
 */
const globalForDb = globalThis as unknown as {
  __landmarkDb?: Db;
};

function connect(): Db {
  if (globalForDb.__landmarkDb) return globalForDb.__landmarkDb;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set — copy .env.example to .env.local and fill it in.');
  }

  const sql = postgres(url, {
    max: 10,
    // Supabase's transaction pooler does not support prepared statements.
    prepare: false,
  });

  globalForDb.__landmarkDb = drizzle(sql, { schema });
  return globalForDb.__landmarkDb;
}

/** Use exactly like a Drizzle client: `db.select().from(leads)`. */
export const db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    return Reflect.get(connect(), prop, receiver);
  },
});

export { schema };
