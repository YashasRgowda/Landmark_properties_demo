import 'server-only';
import { and, eq, gt } from 'drizzle-orm';
import { db } from '@/lib/db';
import { chaseStates, leads, messages, PRIORITY_NORMAL, PRIORITY_TOP, touches, type ChaseState } from '@/lib/db/schema';
import { enqueue } from '@/lib/queue';
import { createCallTask, agentsWithLoad } from '@/lib/calls/create';
import { pickAgent } from '@/lib/agents/assign';
import { CHASE_LABELS, CHASE_STEPS, callFor, sendableAt, stepDueAt } from '@/lib/chase';
import { WRAP_UP_AFTER_MS, cancelActiveChase, enrollChase } from '@/lib/chase-engine';
import type { TaskHandler } from './types';

/**
 * ADVANCE_CHASE — run one step of a follow-up sequence, then queue the next.
 *
 * A WhatsApp step is handed to SEND_CHASE_MESSAGE, so a failed send retries on
 * its own without re-running the sequence. A call step goes straight onto the
 * agent's queue. After the last step the sequence waits three days for an
 * answer; if none comes, it ends and the buyer moves to the monthly drip — he
 * is never deleted.
 */
export const advanceChase: TaskHandler = async ({ task, log }) => {
  const { chaseId, step } = (task.payload ?? {}) as { chaseId?: string; step?: number };
  if (!chaseId || step === undefined) {
    log('no chase on this task');
    return;
  }

  const [chase] = await db.select().from(chaseStates).where(eq(chaseStates.id, chaseId)).limit(1);
  if (!chase || chase.status !== 'ACTIVE') {
    log(`sequence is ${chase?.status ?? 'gone'}; nothing to do`);
    return;
  }
  // A step that has already moved on — a replay or a duplicate. Stand down.
  if (chase.step !== step) {
    log(`sequence is on step ${chase.step}, not ${step}; standing down`);
    return;
  }

  const [lead] = await db.select().from(leads).where(eq(leads.id, chase.leadId)).limit(1);
  if (!lead) return log('lead has gone');
  if (lead.optedOut || ['WON', 'LOST', 'REJECTED'].includes(lead.status)) {
    await cancelActiveChase(lead.id, lead.optedOut ? 'he opted out' : `lead is ${lead.status}`);
    return log('lead is closed or opted out; sequence stopped');
  }

  // Heard from him since this started? Then he is not quiet any more. The
  // reply handler normally stops the sequence first; this is the safety net.
  const [replied] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.leadId, lead.id), eq(messages.direction, 'inbound'), gt(messages.sentAt, chase.createdAt)))
    .limit(1);
  const [pickedUp] = await db
    .select({ id: touches.id })
    .from(touches)
    .where(and(eq(touches.leadId, lead.id), eq(touches.channel, 'call'),
      eq(touches.outcome, 'ANSWERED'), gt(touches.happenedAt, chase.createdAt)))
    .limit(1);
  if (replied || pickedUp) {
    await cancelActiveChase(lead.id, replied ? 'he replied' : 'he picked up a call');
    return log('he has been in touch since; sequence stopped');
  }

  const state = chase.state as ChaseState;
  const steps = CHASE_STEPS[state];
  const now = new Date();

  // Past the last step: the wrap-up. No answer in three days — it is done.
  if (step >= steps.length) {
    await db
      .update(chaseStates)
      .set({ status: 'EXHAUSTED', exhausted: true, endedAt: now, endedReason: 'every step ran, no reply', nextStepAt: null })
      .where(eq(chaseStates.id, chase.id));

    if (state === 'COLD_DRIP') {
      await db.update(leads).set({ nextAction: null, nextActionAt: null, updatedAt: now }).where(eq(leads.id, lead.id));
      return log('the monthly drip has finished; he stays in the system as COLD');
    }

    // Exhausted chases → COLD drip (the spec). Never deleted.
    await db.update(leads).set({ category: 'COLD', updatedAt: now }).where(eq(leads.id, lead.id));
    await enrollChase(lead.id, 'COLD_DRIP', now);
    return log(`${CHASE_LABELS[state]} ran out with no reply; moved to the monthly drip`);
  }

  const current = steps[step];

  // A WhatsApp step to someone not on WhatsApp becomes a call — the phone is
  // the only way to reach him.
  const asCall = current.kind === 'call' || lead.waState === 'NOT_ON_WHATSAPP';

  if (asCall) {
    const { reason, top } = callFor(state);
    let ownerId = lead.ownerAgentId;

    if (state === 'LATE_STAGE') {
      // He was close to buying: it goes to his owner — an active one — and he
      // gets one if he has none.
      const roster = await agentsWithLoad();
      if (ownerId && !roster.some((a) => a.id === ownerId)) ownerId = null;
      if (!ownerId) {
        const pick = pickAgent(roster, lead.language);
        if (pick) {
          ownerId = pick.agent.id;
          await db.update(leads).set({ ownerAgentId: ownerId }).where(eq(leads.id, lead.id));
        }
      }
      await db
        .update(leads)
        .set({ nextAction: 'Was close to buying and went quiet — ring today', nextActionAt: now, updatedAt: now })
        .where(eq(leads.id, lead.id));
    }

    const note = current.kind === 'call' ? current.note : 'Not on WhatsApp — follow up by phone';
    const result = await createCallTask({
      leadId: lead.id,
      reason,
      dueAt: sendableAt('call', now),
      priority: top ? PRIORITY_TOP : PRIORITY_NORMAL,
      agentId: ownerId ?? null,
      notes: [note, lead.summary].filter(Boolean).join(' · '),
      idempotencyKey: `call:chase:${chase.id}:${step}`,
    });
    log(result.created ? `step ${step + 1}: call queued (${reason})` : `step ${step + 1}: no call queued — ${result.why}`);
  } else {
    await enqueue({
      type: 'SEND_CHASE_MESSAGE',
      leadId: lead.id,
      dueAt: now,
      payload: { chaseId: chase.id, step, purpose: current.purpose },
      idempotencyKey: `chase-msg:${chase.id}:${step}`,
    });
    log(`step ${step + 1}: WhatsApp queued (${current.purpose})`);
  }

  // Queue what comes next: the next step, or the three-day wrap-up.
  const next = step + 1;
  const nextAt = next < steps.length
    ? stepDueAt(steps[next], chase.createdAt, now)
    : new Date(now.getTime() + WRAP_UP_AFTER_MS);

  await db
    .update(chaseStates)
    .set({ step: next, nextStepAt: nextAt })
    .where(and(eq(chaseStates.id, chase.id), eq(chaseStates.step, step)));

  await enqueue({
    type: 'ADVANCE_CHASE',
    leadId: lead.id,
    dueAt: nextAt,
    payload: { chaseId: chase.id, step: next },
    idempotencyKey: `chase:${chase.id}:${next}`,
  });

  await db
    .update(leads)
    .set({
      nextAction: next < steps.length ? `Follow-up: ${CHASE_LABELS[state]}` : `Follow-up: waiting for a reply`,
      nextActionAt: nextAt,
      updatedAt: now,
    })
    .where(eq(leads.id, lead.id));

  log(next < steps.length ? `next step ${next + 1} at ${nextAt.toISOString()}` : `last step done; wrap-up at ${nextAt.toISOString()}`);
};

