import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { tasks, TASK_TYPES, type Task, type TaskType } from '@/lib/db/schema';

/**
 * The scheduler. "Send this WhatsApp now" and "ring him at 9:30 tomorrow" are
 * both rows in `tasks`.
 *
 * Everything in this system is: event -> queue -> worker (golden rule 4).
 * Nothing slow ever runs inside a webhook.
 */

import { backoffMs, MAX_ATTEMPTS, STUCK_AFTER_MS } from './queue-policy';

export { backoffMs, MAX_ATTEMPTS, STUCK_AFTER_MS, BACKOFF_MS } from './queue-policy';

export type EnqueueArgs = {
  type: TaskType;
  leadId?: string | null;
  dueAt?: Date;
  payload?: Record<string, unknown> | null;
  /**
   * Makes the enqueue safe to repeat. A second call with the same key returns
   * the first task instead of creating another one — this is what stops a
   * retried webhook from double-sending a message (golden rule 5).
   */
  idempotencyKey?: string | null;
};

export type EnqueueResult = { task: Task; created: boolean };

export async function enqueue(args: EnqueueArgs): Promise<EnqueueResult> {
  if (!(TASK_TYPES as readonly string[]).includes(args.type)) {
    throw new Error(`enqueue: unknown task type "${args.type}"`);
  }

  const dueAt = args.dueAt ?? new Date();
  if (Number.isNaN(dueAt.getTime())) {
    throw new Error('enqueue: dueAt is not a valid date');
  }

  const values = {
    type: args.type,
    leadId: args.leadId ?? null,
    payload: (args.payload ?? null) as Task['payload'],
    dueAt,
    status: 'PENDING' as const,
    idempotencyKey: args.idempotencyKey ?? null,
  };

  // Without a key there is nothing to collide on, so insert plainly.
  if (!values.idempotencyKey) {
    const [task] = await db.insert(tasks).values(values).returning();
    return { task, created: true };
  }

  const inserted = await db
    .insert(tasks)
    .values(values)
    .onConflictDoNothing({ target: tasks.idempotencyKey })
    .returning();

  if (inserted[0]) return { task: inserted[0], created: true };

  const [existing] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.idempotencyKey, values.idempotencyKey))
    .limit(1);

  if (!existing) {
    throw new Error(`enqueue: task for key "${values.idempotencyKey}" could not be created or found`);
  }
  return { task: existing, created: false };
}

/**
 * Take up to `limit` due tasks and mark them RUNNING, in one atomic statement.
 *
 * FOR UPDATE SKIP LOCKED is what makes two workers safe: rows already locked by
 * the other worker are stepped over rather than waited for, so the same task can
 * never be handed out twice.
 *
 * `attempts` is incremented here, at claim time, rather than on failure — if the
 * process dies mid-task the attempt is still counted, so a task that crashes the
 * worker every time cannot retry forever.
 */
export async function claimDueTasks(limit = 50): Promise<Task[]> {
  const rows = await db.execute(sql`
    with claimed as (
      select ${tasks.id} as id
      from ${tasks}
      where ${tasks.status} = 'PENDING'
        and ${tasks.dueAt} <= now()
      order by ${tasks.dueAt} asc
      limit ${limit}
      for update skip locked
    )
    update ${tasks}
       set status     = 'RUNNING',
           attempts   = ${tasks.attempts} + 1,
           started_at = now()
      from claimed
     where ${tasks.id} = claimed.id
    returning ${tasks}.*
  `);

  return (rows as unknown as Record<string, unknown>[]).map(toTask);
}

/** Mark a finished task DONE. */
export async function completeTask(id: string): Promise<void> {
  await db
    .update(tasks)
    .set({ status: 'DONE', lastError: null, startedAt: null })
    .where(eq(tasks.id, id));
}

/**
 * Record a failure: schedule a retry, or give up after MAX_ATTEMPTS.
 * Returns what was decided so the worker can report it.
 */
export async function failTask(
  task: Task,
  error: unknown,
): Promise<{ status: 'PENDING' | 'FAILED'; retryAt: Date | null }> {
  const message = error instanceof Error ? error.message : String(error);
  const trimmed = message.slice(0, 2000);

  if (task.attempts >= MAX_ATTEMPTS) {
    await db
      .update(tasks)
      .set({ status: 'FAILED', lastError: trimmed, startedAt: null })
      .where(eq(tasks.id, task.id));
    return { status: 'FAILED', retryAt: null };
  }

  const retryAt = new Date(Date.now() + backoffMs(task.attempts));
  await db
    .update(tasks)
    .set({ status: 'PENDING', lastError: trimmed, dueAt: retryAt, startedAt: null })
    .where(eq(tasks.id, task.id));
  return { status: 'PENDING', retryAt };
}

/**
 * Rescue tasks left RUNNING by a worker that died. They go back to PENDING —
 * or straight to FAILED if they have already used every attempt.
 * Returns how many were rescued.
 */
export async function reapStuckTasks(olderThanMs = STUCK_AFTER_MS): Promise<number> {
  // The cutoff is built inside SQL from a plain number of seconds. A JS Date
  // cannot be bound as a parameter on this raw-SQL path — postgres.js rejects
  // it — and the failure would otherwise be invisible.
  const seconds = Math.max(1, Math.round(olderThanMs / 1000));

  const rows = await db.execute(sql`
    update ${tasks}
       set status     = case when ${tasks.attempts} >= ${MAX_ATTEMPTS} then 'FAILED' else 'PENDING' end,
           last_error = 'worker stopped before the task finished',
           started_at = null
     where ${tasks.status} = 'RUNNING'
       and ${tasks.startedAt} is not null
       and ${tasks.startedAt} < now() - make_interval(secs => ${seconds})
    returning ${tasks.id}
  `);

  return (rows as unknown as unknown[]).length;
}

/**
 * Cancel every task still waiting for a lead. Used when someone opts out, so a
 * queued message can never reach them.
 */
export async function cancelPendingTasksForLead(leadId: string): Promise<number> {
  const rows = await db
    .update(tasks)
    .set({ status: 'CANCELLED' })
    .where(and(eq(tasks.leadId, leadId), eq(tasks.status, 'PENDING')))
    .returning({ id: tasks.id });
  return rows.length;
}

/** Map a raw snake_case row from db.execute() onto the Task shape. */
function toTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as string,
    leadId: (row.lead_id ?? null) as Task['leadId'],
    type: row.type as string,
    payload: (row.payload ?? null) as Task['payload'],
    dueAt: asDate(row.due_at),
    status: row.status as string,
    attempts: Number(row.attempts),
    startedAt: row.started_at == null ? null : asDate(row.started_at),
    lastError: (row.last_error ?? null) as Task['lastError'],
    idempotencyKey: (row.idempotency_key ?? null) as Task['idempotencyKey'],
    createdAt: asDate(row.created_at),
  };
}

function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}
