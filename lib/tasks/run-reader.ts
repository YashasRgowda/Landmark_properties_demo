import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads, visits } from '@/lib/db/schema';
import { readConversation } from '@/lib/ai/reader';
import { getProjectData, type ProjectInfo } from '@/lib/project-data';
import { parseBudgetToRupees, scoreLead } from '@/lib/scoring';
import { checkVisitTime, describeVisit } from '@/lib/visit-time';
import { enqueue } from '@/lib/queue';
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
  // Null, never 0: a zero entry price would qualify every budget on earth.
  const entryPrice = parseBudgetToRupees(project.entry_price);
  if (entryPrice === null) {
    log(`WARNING: entry price ${JSON.stringify(project.entry_price)} could not be read — ` +
      'no lead can earn the budget points until it is fixed at /admin/project');
  }
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

  // Scoring HOT is not the outcome — a person ringing him is. Queued, not done
  // here, so a missing agent roster cannot fail the scoring that just succeeded.
  if (category === 'HOT') {
    await enqueue({
      type: 'ESCALATE_TO_AGENT',
      leadId,
      dueAt: new Date(),
      idempotencyKey: `escalate:${leadId}`,
    });
    log('HOT — escalation to an agent queued');
  }

  if (facts.visit_agreed && facts.visit_datetime_iso) {
    log(await bookVisit(leadId, facts.visit_datetime_iso, facts.visit_label, project));
  }
};

/**
 * Book the visit, or move it.
 *
 * Two things this must get right, both learned the hard way:
 *
 *  1. A buyer who changes his mind must MOVE his booking. The first version
 *     returned early whenever a booking existed, so the first time the model
 *     read was the time forever — a buyer who settled on 5 PM after floating
 *     6 PM kept 6 PM, and nobody found out until he turned up.
 *  2. Nothing the model returns is trusted. Every timestamp goes through
 *     checkVisitTime first, and a refusal leaves the lead unbooked rather than
 *     sending someone to a locked gate.
 */
async function bookVisit(
  leadId: string,
  iso: string,
  label: string | null,
  project: ProjectInfo,
): Promise<string> {
  const check = checkVisitTime(iso, {
    label,
    openHour: project.site_open_hour,
    closeHour: project.site_close_hour,
  });

  if (!check.ok) {
    // Deliberately not booked. The lead stays in the chase list, which is the
    // safe failure: a missing visit gets followed up, a wrong one does not.
    return `visit NOT booked (${check.reason}) from ${JSON.stringify(iso)} / ${JSON.stringify(label)}`;
  }

  const visitAt = check.at;
  const corrected = check.correctedFromLabel ? ' [time taken from the buyer\'s own words]' : '';

  const [existing] = await db
    .select({ id: visits.id, visitAt: visits.visitAt, label: visits.label })
    .from(visits)
    .where(and(eq(visits.leadId, leadId), eq(visits.status, 'BOOKED')))
    .limit(1);

  if (existing) {
    const sameTime = existing.visitAt.getTime() === visitAt.getTime();
    if (sameTime && (existing.label ?? null) === (label ?? null)) {
      return `visit already booked for ${describeVisit(visitAt)}`;
    }

    await db
      .update(visits)
      .set({ visitAt, label: label ?? existing.label })
      .where(eq(visits.id, existing.id));

    await db
      .update(leads)
      .set({ status: 'VISIT_BOOKED', nextAction: 'Site visit', nextActionAt: visitAt, updatedAt: new Date() })
      .where(eq(leads.id, leadId));

    return sameTime
      ? `visit label updated for ${describeVisit(visitAt)}${corrected}`
      : `visit MOVED from ${describeVisit(existing.visitAt)} to ${describeVisit(visitAt)}${corrected}`;
  }

  await db.insert(visits).values({ leadId, visitAt, label: label ?? null, status: 'BOOKED' });

  await db
    .update(leads)
    .set({ status: 'VISIT_BOOKED', nextAction: 'Site visit', nextActionAt: visitAt, updatedAt: new Date() })
    .where(eq(leads.id, leadId));

  return `visit booked for ${describeVisit(visitAt)}${corrected}`;
}
