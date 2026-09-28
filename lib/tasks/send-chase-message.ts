import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { chaseStates, leads, messages, PRIORITY_NORMAL, type ChaseState } from '@/lib/db/schema';
import { composeFollowUp } from '@/lib/ai/writer';
import { sendTemplate, sendText } from '@/lib/whatsapp/client';
import { templateFor } from '@/lib/whatsapp/templates';
import { createCallTask } from '@/lib/calls/create';
import { cancelActiveChase } from '@/lib/chase-engine';
import { callFor, insideServiceWindow, newVisitSlots, sendableAt, type ChasePurpose } from '@/lib/chase';
import { describeVisit } from '@/lib/visit-time';
import type { TaskHandler } from './types';

/**
 * SEND_CHASE_MESSAGE — one WhatsApp follow-up.
 *
 * WhatsApp's 24-hour rule decides what can go. Within a day of his last
 * message, the Writer's own words. After that, only a template Meta has
 * approved — so there is no point asking the Writer for text that cannot be
 * sent. Either way, if WhatsApp will not take it, the task fails and retries:
 * a follow-up is never quietly dropped.
 */
export const sendChaseMessage: TaskHandler = async ({ task, log }) => {
  const { chaseId, step, purpose } = (task.payload ?? {}) as {
    chaseId?: string; step?: number; purpose?: ChasePurpose;
  };
  if (!chaseId || purpose === undefined || step === undefined) return log('nothing to send');

  const [chase] = await db.select().from(chaseStates).where(eq(chaseStates.id, chaseId)).limit(1);
  if (!chase || chase.status !== 'ACTIVE') {
    return log(`sequence is ${chase?.status ?? 'gone'} — he replied or it was stopped; nothing sent`);
  }

  const [lead] = await db.select().from(leads).where(eq(leads.id, chase.leadId)).limit(1);
  if (!lead) return log('lead has gone');
  if (lead.optedOut) {
    await cancelActiveChase(lead.id, 'he opted out');
    return log('opted out; nothing sent');
  }

  const toCall = async (why: string) => {
    const { reason } = callFor(chase.state as ChaseState);
    const result = await createCallTask({
      leadId: lead.id,
      reason,
      dueAt: sendableAt('call', new Date()),
      priority: PRIORITY_NORMAL,
      notes: `${why} · ${lead.summary ?? ''}`.trim(),
      idempotencyKey: `call:chase-msg:${chaseId}:${step}`,
    });
    log(`${why}; call queued instead (${result.created ? 'new' : result.why})`);
  };

  if (lead.waState === 'NOT_ON_WHATSAPP') return toCall('not on WhatsApp');

  const [lastInbound] = await db
    .select({ sentAt: messages.sentAt })
    .from(messages)
    .where(and(eq(messages.leadId, lead.id), eq(messages.direction, 'inbound')))
    .orderBy(desc(messages.sentAt))
    .limit(1);

  const now = new Date();
  const open = insideServiceWindow(lastInbound?.sentAt ?? null, now);

  let result;
  let sent: string;
  if (open) {
    const slots = purpose === 'new_date' ? newVisitSlots(now).map(describeVisit) : [];
    const followUp = await composeFollowUp({ lead, purpose, slots });
    result = await sendText({ lead, body: followUp.text });
    sent = `sent the Writer's message${followUp.usedFallback ? ` (safe version: ${followUp.why})` : ''}`;
  } else {
    // Outside the 24 hours: only an approved template is allowed.
    const choice = templateFor('followup', lead.name);
    result = await sendTemplate({ lead, ...choice });
    sent = `outside WhatsApp's 24-hour window — sent template ${choice.template}`;
  }

  if (!result.ok) {
    if (result.reason === 'NOT_ON_WHATSAPP') return toCall('WhatsApp says he is not on it');
    if (result.reason === 'OPTED_OUT') {
      await cancelActiveChase(lead.id, 'he opted out');
      return log('opted out; nothing sent');
    }
    // Temporary: throw so the queue retries it.
    throw new Error(`WhatsApp did not accept the follow-up: ${result.error}`);
  }

  log(sent);
};
