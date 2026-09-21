import 'server-only';
import { and, count, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads, messages } from '@/lib/db/schema';
import { composeReply } from '@/lib/ai/meera';
import { isSignificantMessage } from '@/lib/ai/significance';
import { enqueue } from '@/lib/queue';
import { sendText } from './client';

/**
 * Reply to a buyer who just wrote in.
 *
 * Order matters: compose, send, and only then queue the scoring. The buyer must
 * never wait behind The Reader (golden rule 3, mistake 1).
 */
export type RespondResult = {
  sent: boolean;
  usedFallback: boolean;
  readerQueued: boolean;
  reason?: string;
};

export async function respondToBuyer(leadId: string): Promise<RespondResult> {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) return { sent: false, usedFallback: false, readerQueued: false, reason: 'no such lead' };
  if (lead.optedOut) {
    return { sent: false, usedFallback: false, readerQueued: false, reason: 'lead opted out' };
  }

  const reply = await composeReply(lead);
  const result = await sendText({ lead, body: reply.text });

  if (!result.ok) {
    return {
      sent: false,
      usedFallback: reply.usedFallback,
      readerQueued: false,
      reason: `${result.reason}: ${result.error}`,
    };
  }

  // Now, and only now, the slow work.
  const readerQueued = await maybeQueueReader(leadId);

  return { sent: true, usedFallback: reply.usedFallback, readerQueued };
}

/**
 * The Reader runs when the conversation has moved on — roughly every third
 * buyer message, plus the first, so language and name are picked up early.
 * Running it on every message is three AI calls per reply for nothing.
 */
async function maybeQueueReader(leadId: string): Promise<boolean> {
  const [row] = await db
    .select({ n: count() })
    .from(messages)
    .where(and(eq(messages.leadId, leadId), eq(messages.direction, 'inbound')));

  const inboundCount = row?.n ?? 0;
  if (inboundCount === 0) return false;

  // The newest buyer message decides whether this cannot wait.
  const [latest] = await db
    .select({ body: messages.body })
    .from(messages)
    .where(and(eq(messages.leadId, leadId), eq(messages.direction, 'inbound')))
    .orderBy(desc(messages.sentAt))
    .limit(1);

  const urgent = isSignificantMessage(latest?.body);
  const shouldRun = inboundCount === 1 || inboundCount % 3 === 0 || urgent;
  if (!shouldRun) return false;

  await enqueue({
    type: 'RUN_READER',
    leadId,
    dueAt: new Date(),
    // One reading per conversation length — a redelivery cannot double-charge.
    idempotencyKey: `reader:${leadId}:${inboundCount}`,
    payload: { urgent },
  });
  return true;
}
