'use server';

import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads, messages, tasks, touches, visits } from '@/lib/db/schema';
import { requireAdmin } from '@/lib/auth/require';
import { normalisePhone } from '@/lib/phone';
import { isOptOutMessage } from '@/lib/whatsapp/opt-out';
import { composeReply } from '@/lib/ai/meera';
import { cancelPendingTasksForLead, enqueue } from '@/lib/queue';
import { runDueTasks } from '@/lib/tasks/runner';
import { getProjectData } from '@/lib/project-data';

/**
 * The WhatsApp simulator behind /app/debug/chat.
 *
 * It runs the same Meera, the same Reader and the same scoring as the live
 * system, so what you see here is what a buyer would get. The only thing it
 * skips is Meta — nothing is actually delivered.
 *
 * Development only.
 */

const TEST_PHONE = '919000000099';

function guard() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The simulator is not available in production.');
  }
}

export type SimMessage = { direction: string; body: string; sentAt: Date };

export type SimState = {
  messages: SimMessage[];
  lead: {
    name: string | null;
    category: string | null;
    score: number;
    budget: string | null;
    timeline: string | null;
    purpose: string | null;
    language: string | null;
    interestedPlot: string | null;
    summary: string | null;
    status: string;
    optedOut: boolean;
  } | null;
  visit: { label: string | null; visitAt: Date } | null;
  pendingTasks: number;
  cancelledTasks: number;
  lastError?: string;
};

async function testLead() {
  const phone = normalisePhone(TEST_PHONE)!;
  const [existing] = await db.select().from(leads).where(eq(leads.phone, phone)).limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(leads)
    .values({
      phone,
      name: null,
      source: 'website',
      status: 'CHATTING',
      waState: 'REPLIED',
      consentBasis: 'simulator',
    })
    .returning();
  return created;
}

export async function getSimState(): Promise<SimState> {
  await requireAdmin('/app/debug/chat');
  guard();
  return readState();
}

async function readState(lastError?: string): Promise<SimState> {
  const phone = normalisePhone(TEST_PHONE)!;
  const [lead] = await db.select().from(leads).where(eq(leads.phone, phone)).limit(1);
  if (!lead) return { messages: [], lead: null, visit: null, pendingTasks: 0, cancelledTasks: 0, lastError };

  const rows = await db
    .select({ direction: messages.direction, body: messages.body, sentAt: messages.sentAt })
    .from(messages)
    .where(eq(messages.leadId, lead.id))
    .orderBy(asc(messages.sentAt));

  const [visit] = await db
    .select({ label: visits.label, visitAt: visits.visitAt })
    .from(visits)
    .where(and(eq(visits.leadId, lead.id), eq(visits.status, 'BOOKED')))
    .limit(1);

  const pending = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.leadId, lead.id), eq(tasks.status, 'PENDING')));

  const cancelled = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.leadId, lead.id), eq(tasks.status, 'CANCELLED')));

  return {
    messages: rows,
    lead: {
      name: lead.name,
      category: lead.category,
      score: lead.score,
      budget: lead.budget,
      timeline: lead.timeline,
      purpose: lead.purpose,
      language: lead.language,
      interestedPlot: lead.interestedPlot,
      summary: lead.summary,
      status: lead.status,
      optedOut: lead.optedOut,
    },
    visit: visit ?? null,
    pendingTasks: pending.length,
    cancelledTasks: cancelled.length,
    lastError,
  };
}

/** Send one message as the buyer and get Meera's reply. */
export async function sendAsBuyer(text: string): Promise<SimState> {
  await requireAdmin('/app/debug/chat');
  guard();

  const body = text.trim();
  if (!body) return readState('Type something first.');

  const lead = await testLead();

  await db.insert(messages).values({
    leadId: lead.id,
    direction: 'inbound',
    body,
    waMessageId: `sim.${lead.id}.${Date.now()}`,
    status: 'delivered',
  });
  await db.insert(touches).values({
    leadId: lead.id,
    channel: 'whatsapp',
    direction: 'inbound',
    outcome: 'replied',
  });

  // Opt-out is checked before anything is composed, exactly as in the live path.
  if (isOptOutMessage(body)) {
    await db
      .update(leads)
      .set({ optedOut: true, status: 'LOST', updatedAt: new Date() })
      .where(eq(leads.id, lead.id));
    const cancelled = await cancelPendingTasksForLead(lead.id);
    return readState(`Opted out. ${cancelled} pending task(s) cancelled. No reply was sent.`);
  }

  const [fresh] = await db.select().from(leads).where(eq(leads.id, lead.id)).limit(1);
  if (fresh.optedOut) {
    return readState('This lead has opted out — the system refused to message them.');
  }

  let error: string | undefined;
  try {
    const reply = await composeReply(fresh);
    await db.insert(messages).values({
      leadId: lead.id,
      direction: 'outbound',
      body: reply.text,
      waMessageId: `sim.out.${lead.id}.${Date.now()}`,
      status: 'sent',
    });
    await db.insert(touches).values({
      leadId: lead.id,
      channel: 'whatsapp',
      direction: 'outbound',
      outcome: 'sent',
    });
    if (reply.usedFallback) error = 'The AI was unreachable — the buyer got the fallback message.';
  } catch (e) {
    error = e instanceof Error ? e.message : 'Could not compose a reply.';
  }

  // Scoring is queued, then run — same order as live: reply first, score after.
  const inbound = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.leadId, lead.id), eq(messages.direction, 'inbound')));

  if (inbound.length === 1 || inbound.length % 3 === 0) {
    await enqueue({
      type: 'RUN_READER',
      leadId: lead.id,
      dueAt: new Date(),
      idempotencyKey: `sim-reader:${lead.id}:${inbound.length}`,
    });
    await runDueTasks(10);
  }

  return readState(error);
}

/** Force a scoring run, whatever the message count. */
export async function scoreNow(): Promise<SimState> {
  await requireAdmin('/app/debug/chat');
  guard();
  const lead = await testLead();
  await enqueue({
    type: 'RUN_READER',
    leadId: lead.id,
    dueAt: new Date(),
    idempotencyKey: `sim-force:${lead.id}:${Date.now()}`,
  });
  await runDueTasks(10);
  return readState();
}

/** Wipe the test buyer and start over. */
export async function resetChat(): Promise<SimState> {
  await requireAdmin('/app/debug/chat');
  guard();
  const phone = normalisePhone(TEST_PHONE)!;
  await db.delete(leads).where(eq(leads.phone, phone));
  return readState();
}

export async function projectSummary() {
  await requireAdmin('/app/debug/chat');
  const p = await getProjectData();
  return {
    plots: p.plots.map((x) => `${x.size} — ${x.price} (${x.available} left)`),
    entry: p.entry_price,
    salesHead: `${p.sales_head.name} ${p.sales_head.phone}`,
    floor: p.approved_offers.floor_price_per_sqft,
  };
}
