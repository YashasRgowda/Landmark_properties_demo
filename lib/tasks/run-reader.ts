import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads, visits } from '@/lib/db/schema';
import { readConversation } from '@/lib/ai/reader';
import { getProjectData } from '@/lib/project-data';
import { parseBudgetToRupees, scoreLead } from '@/lib/scoring';
import type { TaskHandler } from './types';

/**
 * RUN_READER — scores a lead after Meera has already replied.
 *
 * This is the slow half, kept off the buyer's path on purpose (golden rule 3
 * and mistake 1). If it fails it retries; the buyer never waits for it.
 */
export const runReader: TaskHandler = async ({ task, log }) => {
  const leadId = task.leadId;
  if (!leadId) {
    log('no lead on this task; nothing to read');
    return;
  }

  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) {
    log('lead has gone');
    return;
  }

  const result = await readConversation(leadId);
  if (!result) {
    log('nothing to read yet');
    return;
  }

  const { facts } = result;
  const project = await getProjectData();
  const entryPrice = parseBudgetToRupees(project.entry_price) ?? 0;
  const { score, category, reasons } = scoreLead(facts, entryPrice);

  await db
    .update(leads)
    .set({
      // Never wipe something we already know with a null.
      name: facts.name ?? lead.name,
      budget: facts.budget ?? lead.budget,
      timeline: facts.timeline ?? lead.timeline,
      purpose: facts.purpose ?? lead.purpose,
      language: facts.language ?? lead.language,
      interestedPlot: facts.interested_plot ?? lead.interestedPlot,
      summary: facts.summary || lead.summary,
      score,
      category,
      status: category === 'REJECT' ? 'REJECTED' : lead.status === 'CHATTING' ? 'QUALIFIED' : lead.status,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, leadId));

  log(`${category} (${score}) — ${reasons.map((r) => `${r.signal} +${r.points}`).join(', ') || 'no signals'}`);

  if (facts.visit_agreed && facts.visit_datetime_iso) {
    const booked = await bookVisit(leadId, facts.visit_datetime_iso, facts.visit_label);
    log(booked ? `visit booked for ${facts.visit_datetime_iso}` : 'visit already booked');
  }
};

/**
 * Create the visit, once. A lead may only hold one upcoming booking, so a
 * second mention of the same Sunday does not create a second row.
 */
async function bookVisit(
  leadId: string,
  iso: string,
  label: string | null,
): Promise<boolean> {
  const visitAt = new Date(iso);
  if (Number.isNaN(visitAt.getTime())) return false;
  // Refuse anything in the past — a misread date must not book a visit.
  if (visitAt.getTime() < Date.now()) return false;

  const existing = await db
    .select({ id: visits.id })
    .from(visits)
    .where(and(eq(visits.leadId, leadId), eq(visits.status, 'BOOKED')))
    .limit(1);

  if (existing.length > 0) return false;

  await db.insert(visits).values({
    leadId,
    visitAt,
    label: label ?? null,
    status: 'BOOKED',
  });

  await db
    .update(leads)
    .set({ status: 'VISIT_BOOKED', nextAction: 'Site visit', nextActionAt: visitAt, updatedAt: new Date() })
    .where(eq(leads.id, leadId));

  return true;
}
