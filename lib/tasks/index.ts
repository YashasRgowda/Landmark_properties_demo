import 'server-only';
import type { TaskType } from '@/lib/db/schema';
import type { TaskHandler } from './types';
import { devEcho } from './dev-echo';

/**
 * Every task type maps to exactly one handler.
 *
 * Types listed as `null` are scheduled by later phases and have no handler yet.
 * They fail loudly rather than silently succeeding, so an unfinished path can
 * never look like a working one.
 */
const HANDLERS: Record<TaskType, TaskHandler | null> = {
  DEV_ECHO: devEcho,

  SEND_FIRST_MESSAGE: null, // Phase 5
  CHECK_DELIVERY: null, // Phase 5
  CREATE_CALL_TASK: null, // Phase 5
  RUN_READER: null, // Phase 4
  SEND_CHASE_MESSAGE: null, // Phase 6
  SEND_VISIT_REMINDER: null, // Phase 6
  ESCALATE_TO_AGENT: null, // Phase 5
  ADVANCE_CHASE: null, // Phase 6
};

export function handlerFor(type: string): TaskHandler {
  const handler = HANDLERS[type as TaskType];
  if (handler) return handler;

  if (type in HANDLERS) {
    return async () => {
      throw new Error(`task type "${type}" has no handler yet — it is built in a later phase`);
    };
  }
  return async () => {
    throw new Error(`unknown task type "${type}"`);
  };
}

export type { TaskHandler, TaskContext } from './types';
