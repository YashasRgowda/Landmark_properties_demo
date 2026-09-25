import 'server-only';
import { createCallTask } from '@/lib/calls/create';
import type { CallReason } from '@/lib/db/schema';
import type { TaskHandler } from './types';

/**
 * CREATE_CALL_TASK — put a call in front of an agent at a scheduled moment.
 *
 * The first-hour ladder does not use this: it creates the call immediately so
 * the ten-minute rule holds. This exists for work decided now but only WANTED
 * later — a chase step on day four, a follow-up the morning after a no-show
 * (Phase 6) — where queueing the decision is the point.
 */
export const createCallTaskHandler: TaskHandler = async ({ task, log }) => {
  const leadId = task.leadId;
  if (!leadId) {
    log('no lead on this task');
    return;
  }

  const payload = (task.payload ?? {}) as {
    reason?: CallReason;
    priority?: number;
    notes?: string;
  };

  const result = await createCallTask({
    leadId,
    reason: payload.reason ?? 'CHASE',
    // The task being due IS the call being due.
    dueAt: task.dueAt,
    priority: payload.priority ?? 0,
    notes: payload.notes ?? null,
    idempotencyKey: `call:task:${task.id}`,
  });

  log(result.created ? `call queued (${payload.reason ?? 'CHASE'})` : `no call queued — ${result.why}`);
};
