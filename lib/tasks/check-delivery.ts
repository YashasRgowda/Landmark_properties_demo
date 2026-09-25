import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads, type WaState } from '@/lib/db/schema';
import { decideFirstHourCall } from '@/lib/first-hour';
import { createCallTask } from '@/lib/calls/create';
import type { TaskHandler } from './types';

/**
 * CHECK_DELIVERY — two minutes after the opening message, what became of it?
 *
 * This is the branch point of the whole flowchart. It creates the call task
 * HERE rather than queueing one for later, even when the call itself is not due
 * until 9:30 tomorrow: the hard rule is that a task must EXIST within ten
 * minutes, so that nobody is ever forgotten. When it is due is a separate
 * question from whether anyone has been told to ring him.
 */
export const checkDelivery: TaskHandler = async ({ task, log }) => {
  const leadId = task.leadId;
  if (!leadId) {
    log('no lead on this task');
    return;
  }

  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) {
    log('lead has gone');
    return;
  }
  if (lead.optedOut) {
    log('lead has opted out; no call queued');
    return;
  }

  // Meta has told us nothing yet. Treat silence as "delivered, unopened"
  // rather than skipping: an unknown state must never mean nobody rings him.
  const waState = (lead.waState ?? 'DELIVERED') as WaState;
  if (!lead.waState) log('no delivery state from Meta yet; treating it as unread');

  const decision = decideFirstHourCall(waState, new Date());

  if (!decision.call) {
    // He answered. Meera has the conversation and a call would talk over her.
    await db
      .update(leads)
      .set({ status: lead.status === 'MESSAGE_SENT' ? 'CHATTING' : lead.status, updatedAt: new Date() })
      .where(eq(leads.id, lead.id));
    log(`no call — ${decision.because}`);
    return;
  }

  // Keep the lead's own status telling the same story as the call queue.
  const status =
    waState === 'NOT_ON_WHATSAPP' ? 'NOT_ON_WHATSAPP'
    : waState === 'READ' ? 'READ_NO_REPLY'
    : 'DELIVERED_UNREAD';

  await db.update(leads).set({ status, updatedAt: new Date() }).where(eq(leads.id, lead.id));

  const result = await createCallTask({
    leadId: lead.id,
    reason: decision.reason,
    dueAt: decision.dueAt,
    priority: decision.priority,
    notes: decision.because,
    // One first-hour call per lead, however often this task is retried.
    idempotencyKey: `call:first-hour:${lead.id}`,
  });

  log(
    result.created
      ? `call queued (${decision.reason}) for ${decision.dueAt.toISOString()} — ${decision.because}`
      : `no call queued — ${result.why}`,
  );
};
