'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/require';
import { enqueue } from '@/lib/queue';
import { runDueTasks, type WorkerReport } from '@/lib/tasks/runner';

/** Dev-only helpers behind /app/debug. Both require an admin session. */

export type DebugState = { report?: WorkerReport; message?: string; error?: string };

function guardEnvironment() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The debug tools are not available in production.');
  }
}

export async function runWorkerNow(): Promise<DebugState> {
  await requireAdmin('/app/debug');
  try {
    guardEnvironment();
    const report = await runDueTasks(50);
    revalidatePath('/app/debug');
    return { report };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Worker run failed.' };
  }
}

export async function enqueueTestTask(formData: FormData): Promise<void> {
  await requireAdmin('/app/debug');
  guardEnvironment();

  const seconds = Number(formData.get('seconds') ?? 0);
  const shouldFail = formData.get('fail') === 'on';
  const delay = Number.isFinite(seconds) ? Math.max(0, Math.min(seconds, 3600)) : 0;

  await enqueue({
    type: 'DEV_ECHO',
    dueAt: new Date(Date.now() + delay * 1000),
    payload: {
      message: shouldFail ? 'deliberate test failure' : `test task, due in ${delay}s`,
      fail: shouldFail,
    },
  });

  revalidatePath('/app/debug');
}
