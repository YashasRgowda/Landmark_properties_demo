import 'server-only';
import { and, count, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads, messages } from '@/lib/db/schema';
import { composeReply } from '@/lib/ai/meera';
import { isSignificantMessage } from '@/lib/ai/significance';
import { enqueue } from '@/lib/queue';
import { sendDocument, sendText } from './client';
import { DOCUMENTS, documentsToSend, type DocumentId } from './documents';

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
  /** Documents attached to this turn, by id. */
  documentsSent: DocumentId[];
  reason?: string;
};

/** Pause before the one on-the-spot retry of a reply WhatsApp did not accept. */
const SEND_RETRY_DELAY_MS = 1_500;

/**
 * Meta's id for the buyer's newest message. Ties on the timestamp — Meta's is
 * to the second — are broken by the id, so every caller agrees on which one is
 * newest and exactly one task answers.
 */
export async function latestInboundId(leadId: string): Promise<string | null> {
  const [row] = await db
    .select({ waMessageId: messages.waMessageId })
    .from(messages)
    .where(and(eq(messages.leadId, leadId), eq(messages.direction, 'inbound')))
    .orderBy(desc(messages.sentAt), desc(messages.waMessageId))
    .limit(1);
  return row?.waMessageId ?? null;
}

/** True when a reply exists that was written having seen this buyer message. */
export async function isAnswered(leadId: string, waMessageId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.leadId, leadId),
        eq(messages.direction, 'outbound'),
        eq(messages.replyToWaMessageId, waMessageId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Outbound rows log a document as "[document: <title>]"; this reads them back. */
const DOCUMENT_BY_TITLE = new Map<string, DocumentId>(DOCUMENTS.map((d) => [d.title, d.id]));

export async function respondToBuyer(leadId: string): Promise<RespondResult> {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) {
    return { sent: false, usedFallback: false, readerQueued: false, documentsSent: [], reason: 'no such lead' };
  }
  if (lead.optedOut) {
    return { sent: false, usedFallback: false, readerQueued: false, documentsSent: [], reason: 'lead opted out' };
  }

  // What she is about to answer. Recorded on the reply, so a message the buyer
  // sends while she is composing is not mistaken for already answered.
  const answering = await latestInboundId(leadId);

  const reply = await composeReply(lead);

  let result = await sendText({ lead, body: reply.text, replyTo: answering });

  // A dropped connection to WhatsApp is usually over in a moment — try once
  // more on the spot rather than leaving him waiting for a retry.
  if (!result.ok && result.reason === 'FAILED') {
    console.warn(`[whatsapp] reply not accepted (${result.error}); trying once more`);
    await new Promise((resolve) => setTimeout(resolve, SEND_RETRY_DELAY_MS));
    result = await sendText({ lead, body: reply.text, replyTo: answering });
  }

  if (!result.ok) {
    if (result.reason === 'FAILED') {
      // Still not accepted. Throwing is deliberate: it makes the task retry.
      // The earlier version returned quietly here, the task was marked done,
      // and the buyer's reply was lost for good.
      throw new Error(`WhatsApp did not accept the reply: ${result.error}`);
    }
    // Not on WhatsApp, or opted out: permanent, and retrying cannot help.
    return {
      sent: false,
      usedFallback: reply.usedFallback,
      readerQueued: false,
      documentsSent: [],
      reason: `${result.reason}: ${result.error}`,
    };
  }

  // She promised the papers; the papers go out. Meera writes the words, this
  // sends the files — the model never chooses which. After the text, so a
  // failed attachment can never cost the buyer his answer.
  const documentsSent = await sendPromisedDocuments(lead, reply.text);

  // Now, and only now, the slow work.
  const readerQueued = await maybeQueueReader(leadId);

  return { sent: true, usedFallback: reply.usedFallback, readerQueued, documentsSent };
}

/**
 * Attach whatever this turn owes the buyer.
 *
 * Never throws: a buyer who gets his answer but not his PDF is a small problem,
 * and one that must not turn the whole task into a retry.
 */
async function sendPromisedDocuments(
  lead: typeof leads.$inferSelect,
  replyText: string,
): Promise<DocumentId[]> {
  try {
    const [lastInbound] = await db
      .select({ body: messages.body })
      .from(messages)
      .where(and(eq(messages.leadId, lead.id), eq(messages.direction, 'inbound')))
      .orderBy(desc(messages.sentAt))
      .limit(1);

    // What he has had already, read back off the log — so a redelivered webhook
    // or a retried task cannot send the same certificate twice.
    const previous = await db
      .select({ body: messages.body })
      .from(messages)
      .where(and(eq(messages.leadId, lead.id), eq(messages.direction, 'outbound')))
      .orderBy(desc(messages.sentAt))
      .limit(100);

    const alreadySent = previous
      .map((m) => /^\[document: (.+)\]$/.exec(String(m.body ?? ''))?.[1])
      .filter((title): title is string => Boolean(title));

    const files = documentsToSend({
      buyerText: lastInbound?.body ?? null,
      replyText,
      alreadySent: alreadySent
        .map((title) => DOCUMENT_BY_TITLE.get(title))
        .filter((id): id is DocumentId => Boolean(id)),
    });

    const delivered: DocumentId[] = [];
    for (const file of files) {
      const sent = await sendDocument({
        lead,
        file: file.file,
        title: file.title,
        idempotencyKey: `doc:${lead.id}:${file.id}`,
      });
      if (sent.ok) delivered.push(file.id);
      else console.error(`[documents] ${file.id} not sent — ${sent.reason}: ${sent.error}`);
    }
    return delivered;
  } catch (error) {
    console.error('[documents] could not attach', error);
    return [];
  }
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
