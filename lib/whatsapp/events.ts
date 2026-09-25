import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads, messages, touches, type Lead } from '@/lib/db/schema';
import { normalisePhone } from '@/lib/phone';
import { cancelPendingCallTasks } from '@/lib/calls/create';
import { cancelPendingTasksForLead } from '@/lib/queue';
import { isOptOutMessage } from './opt-out';
import { respondToBuyer } from './respond';
import type { InboundMessageEvent, StatusEvent, WhatsAppEvent } from './parse';

export { parseWebhookPayload } from './parse';
export type { InboundMessageEvent, StatusEvent, WhatsAppEvent } from './parse';

/**
 * Turning Meta's webhook payload into rows.
 *
 * The webhook itself does none of this — it verifies the signature, queues the
 * event and returns 200 (golden rule 4). This runs later, in the worker.
 */

export type ProcessResult = {
  handled: boolean;
  reason?: string;
  leadId?: string;
  optedOut?: boolean;
};

export async function processEvent(event: WhatsAppEvent): Promise<ProcessResult> {
  return event.kind === 'message' ? processInbound(event) : processStatus(event);
}

async function processInbound(event: InboundMessageEvent): Promise<ProcessResult> {
  const phone = normalisePhone(event.from);
  if (!phone) return { handled: false, reason: `unusable sender "${event.from}"` };

  // Meta redelivers on any hiccup. The unique wa_message_id makes that harmless.
  const [seen] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.waMessageId, event.waMessageId))
    .limit(1);
  if (seen) return { handled: true, reason: 'already recorded' };

  const lead = await findOrCreateLead(phone);

  await db.insert(messages).values({
    leadId: lead.id,
    direction: 'inbound',
    body: event.body,
    waMessageId: event.waMessageId,
    status: 'delivered',
    sentAt: event.timestamp,
  });

  await db.insert(touches).values({
    leadId: lead.id,
    channel: 'whatsapp',
    direction: 'inbound',
    outcome: 'replied',
    happenedAt: event.timestamp,
  });

  if (isOptOutMessage(event.body)) {
    await db
      .update(leads)
      .set({
        optedOut: true,
        waState: 'REPLIED',
        status: 'LOST',
        nextAction: null,
        nextActionAt: null,
        updatedAt: new Date(),
      })
      .where(eq(leads.id, lead.id));

    // Nothing queued for this lead may ever go out now — and that includes the
    // agent's call queue, which lives in its own table. A buyer who said STOP
    // and then gets a sales call has been failed twice.
    const cancelled = await cancelPendingTasksForLead(lead.id);
    const calls = await cancelPendingCallTasks(lead.id, 'he opted out');
    return {
      handled: true,
      leadId: lead.id,
      optedOut: true,
      reason: `opted out; ${cancelled} pending task(s) and ${calls} call(s) cancelled`,
    };
  }

  // A reply means the buyer is live. Meera takes over in Phase 4.
  await db
    .update(leads)
    .set({
      waState: 'REPLIED',
      status: lead.status === 'NEW' || lead.status === 'MESSAGE_SENT' ? 'CHATTING' : lead.status,
      lastContactAt: event.timestamp,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, lead.id));

  // He is talking to us, so the call queued because he was NOT talking to us is
  // moot. Cancelling here rather than at the agent's screen means nobody wastes
  // a call on a buyer who is already mid-conversation with Meera.
  const stale = await cancelPendingCallTasks(lead.id, 'he replied on WhatsApp');
  if (stale > 0) console.log(`[whatsapp] cancelled ${stale} call task(s); the buyer replied`);

  // Reply now. Scoring is queued inside respondToBuyer, never before the send.
  try {
    const replied = await respondToBuyer(lead.id);
    return {
      handled: true,
      leadId: lead.id,
      reason: replied.sent
        ? `replied${replied.usedFallback ? ' (fallback)' : ''}${replied.readerQueued ? ', reader queued' : ''}`
        : `no reply sent — ${replied.reason}`,
    };
  } catch (error) {
    // The message is already saved. A failed reply must not lose it.
    console.error('[whatsapp] could not reply', error);
    return { handled: true, leadId: lead.id, reason: 'saved, but the reply failed' };
  }
}

async function processStatus(event: StatusEvent): Promise<ProcessResult> {
  const [message] = await db
    .select({ id: messages.id, leadId: messages.leadId, status: messages.status })
    .from(messages)
    .where(eq(messages.waMessageId, event.waMessageId))
    .limit(1);

  if (!message) return { handled: false, reason: 'status for a message we did not send' };

  // Statuses can arrive out of order. Never go backwards.
  const RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
  const current = RANK[message.status ?? 'queued'] ?? 0;
  const incoming = RANK[event.status] ?? 0;
  if (incoming <= current && event.status !== 'failed') {
    return { handled: true, leadId: message.leadId, reason: 'older status ignored' };
  }

  await db.update(messages).set({ status: event.status }).where(eq(messages.id, message.id));

  const [lead] = await db.select().from(leads).where(eq(leads.id, message.leadId)).limit(1);
  if (!lead) return { handled: true, reason: 'lead has gone' };

  // A buyer who already replied stays REPLIED — that outranks any tick.
  if (lead.waState === 'REPLIED') {
    return { handled: true, leadId: lead.id, reason: 'lead already replied' };
  }

  if (event.status === 'failed') {
    await db
      .update(leads)
      .set({ waState: 'NOT_ON_WHATSAPP', status: 'NOT_ON_WHATSAPP', updatedAt: new Date() })
      .where(eq(leads.id, lead.id));
    await db.insert(touches).values({
      leadId: lead.id,
      channel: 'whatsapp',
      direction: 'outbound',
      outcome: 'undeliverable',
      notes: event.errorMessage?.slice(0, 500) ?? null,
    });
    return { handled: true, leadId: lead.id };
  }

  if (event.status === 'delivered' || event.status === 'read') {
    await db
      .update(leads)
      .set({
        waState: event.status === 'read' ? 'READ' : 'DELIVERED',
        status: event.status === 'read' ? 'READ_NO_REPLY' : 'DELIVERED_UNREAD',
        updatedAt: new Date(),
      })
      .where(eq(leads.id, lead.id));

    await db.insert(touches).values({
      leadId: lead.id,
      channel: 'whatsapp',
      direction: 'outbound',
      outcome: event.status,
      happenedAt: event.timestamp,
    });
  }

  return { handled: true, leadId: lead.id };
}

/**
 * Someone can message the business number without ever filling a portal form.
 * Creating the lead means no buyer is ever dropped.
 */
async function findOrCreateLead(phone: string): Promise<Lead> {
  const [existing] = await db.select().from(leads).where(eq(leads.phone, phone)).limit(1);
  if (existing) return existing;

  const inserted = await db
    .insert(leads)
    .values({
      phone,
      source: 'whatsapp',
      status: 'CHATTING',
      waState: 'REPLIED',
      consentBasis: 'messaged_us_first',
    })
    .onConflictDoNothing({ target: leads.phone })
    .returning();

  if (inserted[0]) return inserted[0];

  const [raced] = await db.select().from(leads).where(eq(leads.phone, phone)).limit(1);
  if (!raced) throw new Error(`could not create a lead for ${phone}`);
  return raced;
}
