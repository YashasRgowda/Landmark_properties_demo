import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads, PRIORITY_TOP } from '@/lib/db/schema';
import { pickAgent } from '@/lib/agents/assign';
import { agentsWithLoad, createCallTask } from '@/lib/calls/create';
import type { TaskHandler } from './types';

/**
 * ESCALATE_TO_AGENT — a lead has scored HOT, so a person takes over.
 *
 * Two things happen and neither may be skipped: the lead gets an owner, and
 * that owner gets a call at the top of the queue. A hot lead with an owner but
 * no call is just a name on a list.
 */
export const escalateToAgent: TaskHandler = async ({ task, log }) => {
  const payload = (task.payload ?? {}) as { reason?: 'HOT_LEAD' | 'CALLBACK' };
  const reason = payload.reason === 'CALLBACK' ? 'CALLBACK' : 'HOT_LEAD';
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
    log('lead has opted out; not escalated');
    return;
  }

  const roster = await agentsWithLoad();
  if (roster.length === 0) {
    // Nobody to hand him to. Fail loudly rather than dropping a hot lead —
    // this retries, and shows up in the dead-letter view if it keeps failing.
    throw new Error('no active agents to escalate to — add one at /admin/agents');
  }

  // Keep an owner he already has; moving a hot lead between agents mid-chase
  // loses whatever rapport the first one built.
  // ...unless that owner has since been deactivated: a hot lead's call must
  // never wait on someone who has left.
  let ownerId = lead.ownerAgentId && roster.some((a) => a.id === lead.ownerAgentId)
    ? lead.ownerAgentId
    : null;
  let why = 'already owned';

  if (!ownerId) {
    const pick = pickAgent(roster, lead.language);
    if (!pick) throw new Error('no agent could be chosen');
    ownerId = pick.agent.id;
    why = pick.because;

    await db
      .update(leads)
      .set({ ownerAgentId: ownerId, updatedAt: new Date() })
      .where(eq(leads.id, lead.id));
  }

  const owner = roster.find((a) => a.id === ownerId);
  log(`owner: ${owner?.name ?? 'unknown'} — ${why}`);

  await db
    .update(leads)
    .set({ status: 'WITH_AGENT', nextAction: 'Call the buyer', nextActionAt: new Date(), updatedAt: new Date() })
    .where(eq(leads.id, lead.id));

  const result = await createCallTask({
    leadId: lead.id,
    reason,
    dueAt: new Date(),
    priority: PRIORITY_TOP,
    agentId: ownerId,
    notes: brief(lead),
    // A buyer promised a call and a buyer who scored HOT are two different
    // promises, so one must not swallow the other.
    idempotencyKey: `call:${reason === 'CALLBACK' ? 'asked' : 'hot'}:${lead.id}`,
  });

  log(result.created ? `${reason} call queued at the top` : `no call queued — ${result.why}`);
};

/** What the agent needs to know before the phone rings, in one line. */
function brief(lead: typeof leads.$inferSelect): string {
  const parts = [
    lead.summary,
    lead.budget && `budget ${lead.budget}`,
    lead.timeline && `timeline ${lead.timeline}`,
    lead.interestedPlot && `interested in ${lead.interestedPlot}`,
    lead.language && `speaks ${lead.language}`,
  ].filter(Boolean);

  return parts.join(' · ').slice(0, 500) || 'Scored HOT — see the conversation.';
}
