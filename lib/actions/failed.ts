'use server';

import { after } from 'next/server';
import { revalidatePath } from 'next/cache';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/require';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { queueEnv } from '@/lib/queue-policy';
import { runDueTasks } from '@/lib/tasks/runner';

/** Only this environment's jobs — the database is shared with the laptop. */
function ownJobs() {
  const env = queueEnv();
  return env === 'production' ? or(eq(tasks.env, env), isNull(tasks.env))! : eq(tasks.env, env);
}

/** Try a job again from scratch, now. */
export async function retryTask(formData: FormData): Promise<void> {
  await requireAdmin('/app/debug/failed');
  const id = String(formData.get('taskId') ?? '');
  if (!id) return;
  await db
    .update(tasks)
    .set({ status: 'PENDING', attempts: 0, dueAt: new Date(), startedAt: null })
    .where(and(eq(tasks.id, id), inArray(tasks.status, ['FAILED', 'PENDING']), ownJobs()));
  after(async () => {
    try { await runDueTasks(5, { budgetMs: 54_000 }); } catch (e) { console.error('[failed] retry run', e); }
  });
  revalidatePath('/app/debug/failed');
}

/** Give up on a job for good — it is kept, marked cancelled, not deleted. */
export async function dismissTask(formData: FormData): Promise<void> {
  await requireAdmin('/app/debug/failed');
  const id = String(formData.get('taskId') ?? '');
  if (!id) return;
  await db
    .update(tasks)
    .set({ status: 'CANCELLED' })
    .where(and(eq(tasks.id, id), inArray(tasks.status, ['FAILED', 'PENDING']), ownJobs()));
  revalidatePath('/app/debug/failed');
}
