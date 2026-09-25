import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads } from '@/lib/db/schema';
import { sendTemplate } from '@/lib/whatsapp/client';
import { enqueue } from '@/lib/queue';
import { DELIVERY_CHECK_DELAY_MS } from '@/lib/first-hour';
import type { TaskHandler } from './types';

/**
 * SEND_FIRST_MESSAGE — the opening WhatsApp, due immediately at ANY hour.
 *
 * Messaging at 2 AM is deliberate: a plot buyer browsing at night gets an answer
 * waiting for him, and WhatsApp is silent-by-default in a way a phone call is
 * not. Calls are the thing that waits for morning, not this.
 *
 * Meta only allows a pre-approved template to open a conversation, so the
 * template name is configuration — point it at Landmark's own approved template
 * once they have one; `hello_world` exists on every test number and lets the
 * whole ladder be exercised today.
 */
export const sendFirstMessage: TaskHandler = async ({ task, log }) => {
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
    log('lead has opted out; nothing sent');
    return;
  }
  // A lead already in conversation must not be sent the opening line again.
  if (lead.waState === 'REPLIED') {
    log('he is already talking to us; no opening message needed');
    return;
  }

  const template = process.env.WHATSAPP_FIRST_TEMPLATE?.trim() || 'hello_world';
  const language = process.env.WHATSAPP_FIRST_TEMPLATE_LANG?.trim() || 'en_US';
  // hello_world takes no placeholders; a real template greets him by name.
  const variables = template === 'hello_world' ? [] : [firstName(lead.name) || 'there'];

  const result = await sendTemplate({
    lead,
    template,
    language,
    variables,
    // A retried task must not send a second opening message.
    idempotencyKey: `first:${lead.id}`,
  });

  if (!result.ok) {
    if (result.reason === 'NOT_ON_WHATSAPP') {
      // sendTemplate has already recorded the state. The delivery check turns
      // this into a phone-only lead and a top-priority call.
      log('not on WhatsApp — the delivery check will queue a call');
    } else if (result.reason === 'OPTED_OUT') {
      log('lead has opted out; nothing sent');
      return;
    } else {
      // Let the queue retry: a transient Meta failure must not silently drop
      // the one message this lead was promised.
      throw new Error(`could not send the opening message: ${result.error}`);
    }
  } else {
    await db
      .update(leads)
      .set({ status: 'MESSAGE_SENT', updatedAt: new Date() })
      .where(eq(leads.id, lead.id));
    log('opening message sent');
  }

  // Either way, ask in two minutes what became of it.
  await enqueue({
    type: 'CHECK_DELIVERY',
    leadId: lead.id,
    dueAt: new Date(Date.now() + DELIVERY_CHECK_DELAY_MS),
    idempotencyKey: `check:${lead.id}`,
  });
  log('delivery check queued for two minutes from now');
};

function firstName(name: string | null): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}
