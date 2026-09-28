import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leadDrought, type Drought } from './lead-drought';

/** Reserved for tests and simulators — never counts as a real enquiry. */
const TEST_PHONE_PREFIX = '91900000';

/** The drought alert, worked out from the newest real lead. */
export async function checkLeadDrought(now = new Date()): Promise<Drought> {
  const rows = (await db.execute(sql`
    select max(created_at) as last from leads where phone not like ${TEST_PHONE_PREFIX + '%'}
  `)) as unknown as { last: string | Date | null }[];
  const last = rows[0]?.last ? new Date(rows[0].last) : null;
  return leadDrought(last, now);
}
