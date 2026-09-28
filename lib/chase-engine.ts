import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { callTasks, chaseStates, leads, tasks, type CallOutcome, type ChaseState } from '@/lib/db/schema';
import { enqueue } from '@/lib/queue';
import { createCallTask } from '@/lib/calls/create';
import {
  CHASE_LABELS,
  CHASE_STEPS,
  classifyQuietLead,
  needsVisitCheck,
  reminderAt,
  sendableAt,
  stepDueAt,
  type QuietFacts,
} from '@/lib/chase';
import { describeVisit } from '@/lib/visit-time';

/**
 * Starting, stopping and finding follow-up sequences. The rules live in
 * lib/chase.ts; this is where they meet the database.
 */

/** After the last step, how long to wait for a reply before calling it done. */
export const WRAP_UP_AFTER_MS = 3 * 24 * 60 * 60_000;

/** Task types that belong to a running sequence — cancelled with it. */
const CHASE_TASK_TYPES = ['ADVANCE_CHASE', 'SEND_CHASE_MESSAGE'];

/**
 * Put a buyer into a sequence. Returns false when he is already in one — the
 * database allows one live sequence per lead, so two timer runs that overlap
 * cannot both start one.
 */
export async function enrollChase(
  leadId: string,
  state: ChaseState,
  now = new Date(),
): Promise<{ created: boolean; chaseId?: string }> {
  const first = CHASE_STEPS[state][0];
  const dueAt = stepDueAt(first, now, now);

  const [chase] = await db
    .insert(chaseStates)
    .values({ leadId, state, step: 0, nextStepAt: dueAt, status: 'ACTIVE', createdAt: now })
    .onConflictDoNothing()
    .returning({ id: chaseStates.id });

  if (!chase) return { created: false };

  await enqueue({
    type: 'ADVANCE_CHASE',
    leadId,
    dueAt,
    payload: { chaseId: chase.id, step: 0 },
    idempotencyKey: `chase:${chase.id}:0`,
  });

  await db
    .update(leads)
    .set({ nextAction: `Follow-up: ${CHASE_LABELS[state]}`, nextActionAt: dueAt, updatedAt: new Date() })
    .where(eq(leads.id, leadId));

  return { created: true, chaseId: chase.id };
}

/**
 * Stop his live sequence, and everything it had queued. Returns whether there
 * was one. Called when he replies, picks up the phone, opts out, or when an
 * agent starts a different sequence.
 */
export async function cancelActiveChase(leadId: string, reason: string): Promise<boolean> {
  const ended = await db
    .update(chaseStates)
    .set({ status: 'CANCELLED', endedAt: new Date(), endedReason: reason, nextStepAt: null })
    .where(and(eq(chaseStates.leadId, leadId), eq(chaseStates.status, 'ACTIVE')))
    .returning({ id: chaseStates.id });

  if (ended.length === 0) return false;

  await db
    .update(tasks)
    .set({ status: 'CANCELLED', lastError: `follow-up stopped: ${reason}` })
    .where(and(
      eq(tasks.leadId, leadId),
      eq(tasks.status, 'PENDING'),
      inArray(tasks.type, CHASE_TASK_TYPES),
    ));

  await db
    .update(callTasks)
    .set({ status: 'CANCELLED', notes: `follow-up stopped: ${reason}`, completedAt: new Date() })
    .where(and(
      eq(callTasks.leadId, leadId),
      eq(callTasks.status, 'PENDING'),
      inArray(callTasks.reason, ['CHASE', 'NO_SHOW', 'LATE_STAGE']),
    ));

  return true;
}

/** Pull a sequence's next step forward to now. For the admin's "next step now". */
export async function runChaseStepNow(leadId: string): Promise<boolean> {
  const [chase] = await db
    .select({ id: chaseStates.id })
    .from(chaseStates)
    .where(and(eq(chaseStates.leadId, leadId), eq(chaseStates.status, 'ACTIVE')))
    .limit(1);
  if (!chase) return false;

  await db
    .update(tasks)
    .set({ dueAt: new Date(Date.now() - 1000) })
    .where(and(
      eq(tasks.leadId, leadId),
      eq(tasks.status, 'PENDING'),
      inArray(tasks.type, CHASE_TASK_TYPES),
    ));
  await db
    .update(chaseStates)
    .set({ nextStepAt: new Date() })
    .where(eq(chaseStates.id, chase.id));
  return true;
}

/* ------------------------------------------------------------ the sweep */

export type SweepOptions = {
  now?: Date;
  /** Only leads whose phone starts with this — how local tests stay on test numbers. */
  onlyPhonePrefix?: string;
  /** Leave out leads whose phone starts with this — how production skips test numbers. */
  excludePhonePrefix?: string;
  /** Report who WOULD be followed up, and start nothing. */
  dryRun?: boolean;
};

export type SweepReport = {
  checked: number;
  enrolled: { leadId: string; phone: string; state: ChaseState; because: string }[];
  visitChecks: number;
};

/**
 * Find buyers who have gone quiet and start the right sequence for each; and
 * find visits whose time has passed with nobody saying whether he came.
 *
 * Runs on the one-minute timer in production. It only ever starts sequences —
 * never sends anything itself — so running it often is cheap and safe.
 */
export async function sweepChases(options: SweepOptions = {}): Promise<SweepReport> {
  const now = options.now ?? new Date();
  const only = options.onlyPhonePrefix ? `${options.onlyPhonePrefix}%` : null;
  const skip = options.excludePhonePrefix ? `${options.excludePhonePrefix}%` : null;

  const rows = (await db.execute(sql`
    select
      l.id, l.phone, l.status, l.category, l.opted_out, l.created_at,
      (select min(m.sent_at) from messages m where m.lead_id = l.id and m.direction = 'outbound') as first_outbound_at,
      (select max(m.sent_at) from messages m where m.lead_id = l.id and m.direction = 'inbound') as last_inbound_at,
      (select count(*)::int from messages m where m.lead_id = l.id and m.direction = 'inbound') as inbound_count,
      (select max(t.happened_at) from touches t
         where t.lead_id = l.id and t.channel = 'call' and t.outcome = 'ANSWERED') as last_answered_call_at,
      (select count(*)::int from touches t
         where t.lead_id = l.id and t.channel = 'call' and t.outcome in ('NO_ANSWER', 'BUSY')
           and t.happened_at > coalesce((select max(t2.happened_at) from touches t2
             where t2.lead_id = l.id and t2.channel = 'call' and t2.outcome = 'ANSWERED'), '-infinity'::timestamptz)
      ) as missed_since_answered,
      (select row_to_json(v) from (select v.id, v.status, v.visit_at from visits v
         where v.lead_id = l.id order by v.visit_at desc limit 1) v) as last_visit,
      exists (select 1 from chase_states c where c.lead_id = l.id and c.status = 'ACTIVE') as has_active_chase,
      (select row_to_json(c) from (select c.status, c.ended_at from chase_states c
         where c.lead_id = l.id and c.ended_at is not null order by c.ended_at desc limit 1) c) as last_ended_chase
    from leads l
    where l.opted_out = false
      and l.status not in ('WON', 'LOST', 'REJECTED')
      and (${only}::text is null or l.phone like ${only})
      and (${skip}::text is null or l.phone not like ${skip})
    order by l.updated_at desc
    limit 500
  `)) as unknown as Record<string, unknown>[];

  const date = (v: unknown) => (v == null ? null : v instanceof Date ? v : new Date(String(v)));
  const report: SweepReport = { checked: rows.length, enrolled: [], visitChecks: 0 };

  for (const r of rows) {
    const visit = r.last_visit as { id: string; status: string; visit_at: string } | null;
    const ended = r.last_ended_chase as { status: string; ended_at: string } | null;

    const facts: QuietFacts = {
      status: String(r.status),
      category: (r.category as string | null) ?? null,
      optedOut: Boolean(r.opted_out),
      createdAt: date(r.created_at)!,
      firstOutboundAt: date(r.first_outbound_at),
      lastInboundAt: date(r.last_inbound_at),
      inboundCount: Number(r.inbound_count ?? 0),
      lastAnsweredCallAt: date(r.last_answered_call_at),
      missedCallsSinceAnswered: Number(r.missed_since_answered ?? 0),
      lastVisit: visit ? { status: visit.status, visitAt: new Date(visit.visit_at) } : null,
      hasActiveChase: Boolean(r.has_active_chase),
      lastEndedChase: ended ? { status: ended.status, endedAt: new Date(ended.ended_at) } : null,
    };

    try {
      if (options.dryRun) {
        const verdict = classifyQuietLead(facts, now);
        if (verdict) report.enrolled.push({ leadId: String(r.id), phone: String(r.phone), state: verdict.state, because: verdict.because });
        if (visit && needsVisitCheck({ status: visit.status, visitAt: new Date(visit.visit_at) }, now)) report.visitChecks++;
        continue;
      }

      if (visit && needsVisitCheck({ status: visit.status, visitAt: new Date(visit.visit_at) }, now)) {
        const call = await createCallTask({
          leadId: String(r.id),
          reason: 'VISIT_CHECK',
          dueAt: now,
          notes: `His visit was ${describeVisit(new Date(visit.visit_at))}. Did he come? Mark it on his page.`,
          idempotencyKey: `call:visit-check:${visit.id}`,
        });
        if (call.created) report.visitChecks++;
      }

      const verdict = classifyQuietLead(facts, now);
      if (!verdict) continue;

      const { created } = await enrollChase(String(r.id), verdict.state, now);
      if (created) report.enrolled.push({ leadId: String(r.id), phone: String(r.phone), state: verdict.state, because: verdict.because });
    } catch (error) {
      // One bad lead must never stop the sweep for the rest (mistake 7).
      console.error(`[chase] sweep failed for lead ${String(r.id)}`, error);
    }
  }

  return report;
}

/* ----------------------------------------------------- after a call */

/** When he asks to be rung back, how long before the callback. */
const CALLBACK_AFTER_MS = 3 * 60 * 60_000;

/**
 * What an agent's call result means for the follow-ups. Called once the call
 * is recorded, so a person never has to remember to stop a sequence or book a
 * callback by hand.
 */
export async function afterCallOutcome(leadId: string, outcome: CallOutcome): Promise<string> {
  switch (outcome) {
    case 'ANSWERED': {
      const stopped = await cancelActiveChase(leadId, 'he picked up a call');
      return stopped ? 'he picked up — follow-ups stopped' : 'he picked up';
    }
    case 'NOT_INTERESTED':
    case 'WRONG_NUMBER': {
      await cancelActiveChase(leadId, outcome === 'NOT_INTERESTED' ? 'not interested' : 'wrong number');
      await db
        .update(leads)
        .set({ status: 'LOST', nextAction: null, nextActionAt: null, updatedAt: new Date() })
        .where(eq(leads.id, leadId));
      return 'closed — he will not be followed up';
    }
    case 'CALLBACK_REQUESTED': {
      await cancelActiveChase(leadId, 'he asked to be rung back');
      const at = sendableAt('call', new Date(Date.now() + CALLBACK_AFTER_MS));
      await createCallTask({
        leadId,
        reason: 'CALLBACK',
        dueAt: at,
        notes: 'He picked up and asked to be rung back',
        idempotencyKey: `call:callback:${leadId}:${Date.now()}`,
      });
      await db.update(leads).set({ nextAction: 'Call him back', nextActionAt: at, updatedAt: new Date() })
        .where(eq(leads.id, leadId));
      return `callback booked for ${describeVisit(at)}`;
    }
    default:
      // No answer or busy: the sequence carries on, and a run of these is
      // exactly what marks him as unreachable.
      return 'no change to follow-ups';
  }
}

/* ------------------------------------------------------ visit reminders */

/**
 * Queue the reminder for a visit. Keyed on the visit AND its time, so moving a
 * visit queues a fresh reminder; the old one sees the time has changed when it
 * runs, and stands down.
 */
export async function scheduleVisitReminder(visitId: string, leadId: string, visitAt: Date): Promise<Date | null> {
  const at = reminderAt(visitAt, new Date());
  if (!at) return null;
  await enqueue({
    type: 'SEND_VISIT_REMINDER',
    leadId,
    dueAt: at,
    payload: { visitId, visitAt: visitAt.toISOString() },
    idempotencyKey: `reminder:${visitId}:${visitAt.getTime()}`,
  });
  return at;
}
