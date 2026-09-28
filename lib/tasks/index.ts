import 'server-only';
import type { TaskType } from '@/lib/db/schema';
import type { TaskHandler } from './types';
import { devEcho } from './dev-echo';
import { processWaEvent } from './whatsapp-event';
import { runReader } from './run-reader';
import { sendFirstMessage } from './send-first-message';
import { checkDelivery } from './check-delivery';
import { createCallTaskHandler } from './create-call-task';
import { escalateToAgent } from './escalate-to-agent';
import { advanceChase } from './advance-chase';
import { sendChaseMessage } from './send-chase-message';
import { sendVisitReminder } from './send-visit-reminder';

/**
 * Every task type maps to exactly one handler.
 *
 * Types listed as `null` are scheduled by later phases and have no handler yet.
 * They fail loudly rather than silently succeeding, so an unfinished path can
 * never look like a working one.
 */
const HANDLERS: Record<TaskType, TaskHandler | null> = {
  DEV_ECHO: devEcho,
  PROCESS_WA_EVENT: processWaEvent,

  SEND_FIRST_MESSAGE: sendFirstMessage,
  CHECK_DELIVERY: checkDelivery,
  CREATE_CALL_TASK: createCallTaskHandler,
  RUN_READER: runReader,
  SEND_CHASE_MESSAGE: sendChaseMessage,
  SEND_VISIT_REMINDER: sendVisitReminder,
  ESCALATE_TO_AGENT: escalateToAgent,
  ADVANCE_CHASE: advanceChase,
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
