'use server';

import { after } from 'next/server';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { requireAdmin, requireUser } from '@/lib/auth/require';
import { db } from '@/lib/db';
import { callTasks, CHASE_STATES, leads, visits, type ChaseState } from '@/lib/db/schema';
import { cancelActiveChase, enrollChase, runChaseStepNow } from '@/lib/chase-engine';
import { runDueTasks } from '@/lib/tasks/runner';

/**
 * The controls on a buyer's page: follow-up sequences and visit outcomes.
 *
 * Each action runs the queue straight after, so what it starts happens now
 * rather than on the next tick of the one-minute timer.
 */

function runQueueSoon() {
  after(async () => {
    try {
      await runDueTasks(10, { budgetMs: 54_000 });
    } catch (error) {
      console.error('[chase actions] could not run the queue', error);
    }
  });
}

function leadPage(leadId: string) {
  revalidatePath(`/app/leads/${leadId}`);
  revalidatePath('/app/calls');
  revalidatePath('/app/visits');
  revalidatePath('/app');
}

/**
 * Start a sequence by hand. Normally the timer starts them when a buyer goes
 * quiet; this is for an admin who knows better — and for a demo, where nobody
 * wants to wait two days.
 */
export async function startFollowUp(formData: FormData): Promise<void> {
  await requireAdmin();
  const leadId = String(formData.get('leadId') ?? '');
  const state = String(formData.get('state') ?? '') as ChaseState;
  if (!leadId || !(CHASE_STATES as readonly string[]).includes(state)) return;

  await cancelActiveChase(leadId, 'an admin started a different follow-up');
  await enrollChase(leadId, state);
  runQueueSoon();
  leadPage(leadId);
}

/** Run the next step now instead of on its scheduled day. */
export async function nextFollowUpStep(formData: FormData): Promise<void> {
  await requireAdmin();
  const leadId = String(formData.get('leadId') ?? '');
  if (!leadId) return;
  await runChaseStepNow(leadId);
  runQueueSoon();
  leadPage(leadId);
}

export async function stopFollowUp(formData: FormData): Promise<void> {
  await requireAdmin();
  const leadId = String(formData.get('leadId') ?? '');
  if (!leadId) return;
  await cancelActiveChase(leadId, 'stopped by an admin');
  leadPage(leadId);
}

/**
 * Came, or didn't come. A no-show starts his follow-up at once — the same-day
 * message is the one that matters most.
 */
export async function markVisit(formData: FormData): Promise<void> {
  await requireUser();
  const visitId = String(formData.get('visitId') ?? '');
  const outcome = String(formData.get('outcome') ?? '');
  if (!visitId || !['ATTENDED', 'NO_SHOW'].includes(outcome)) return;

  const [visit] = await db
    .update(visits)
    .set({ status: outcome, outcomeAt: new Date() })
    .where(and(eq(visits.id, visitId), eq(visits.status, 'BOOKED')))
    .returning({ leadId: visits.leadId });
  if (!visit) return; // already marked, or not a booked visit

  // The "did he come?" call is no longer needed — nobody rang, so it is
  // cancelled rather than recorded as a call that happened.
  await db
    .update(callTasks)
    .set({ status: 'CANCELLED', notes: `visit marked ${outcome} on his page`, completedAt: new Date() })
    .where(and(eq(callTasks.leadId, visit.leadId), eq(callTasks.status, 'PENDING'), eq(callTasks.reason, 'VISIT_CHECK')));

  if (outcome === 'ATTENDED') {
    await db
      .update(leads)
      .set({ status: 'VISITED', nextAction: null, nextActionAt: null, updatedAt: new Date() })
      .where(eq(leads.id, visit.leadId));
  } else {
    // No longer "visit booked": he is a qualified buyer who needs a new date.
    await db
      .update(leads)
      .set({ status: 'QUALIFIED', updatedAt: new Date() })
      .where(eq(leads.id, visit.leadId));
    await cancelActiveChase(visit.leadId, 'missed his visit');
    await enrollChase(visit.leadId, 'NO_SHOW');
    runQueueSoon();
  }
  leadPage(visit.leadId);
}
