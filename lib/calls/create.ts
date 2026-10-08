import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agents, callTasks, leads, touches, type CallOutcome, type CallReason } from '@/lib/db/schema';

/**
 * Putting a call in front of a human, and taking it away again.
 *
 * Every route into the agent's queue comes through here — the first-hour ladder,
 * a hot-lead escalation, a chase step — so the rules about opted-out leads and
 * duplicate work live in one place rather than at four call sites.
 */

export type CreateCallTaskArgs = {
  leadId: string;
  reason: CallReason;
  dueAt: Date;
  priority?: number;
  notes?: string | null;
  agentId?: string | null;
  /** Same key twice never creates a second call. */
  idempotencyKey?: string | null;
};

export type CreateCallTaskResult =
  | { created: true; id: string }
  | { created: false; why: 'opted out' | 'already queued' | 'lead has gone' };

export async function createCallTask(args: CreateCallTaskArgs): Promise<CreateCallTaskResult> {
  const [lead] = await db
    .select({ id: leads.id, optedOut: leads.optedOut })
    .from(leads)
    .where(eq(leads.id, args.leadId))
    .limit(1);

  if (!lead) return { created: false, why: 'lead has gone' };
  // Asking an agent to ring someone who said STOP is the same violation as
  // messaging him, so it is refused in the same place.
  if (lead.optedOut) return { created: false, why: 'opted out' };

  // One open call per lead. A second reason to ring him is not a second call —
  // the agent picks up the phone once.
  const [open] = await db
    .select({ id: callTasks.id })
    .from(callTasks)
    .where(and(eq(callTasks.leadId, args.leadId), eq(callTasks.status, 'PENDING')))
    .limit(1);

  if (open) return { created: false, why: 'already queued' };

  const [row] = await db
    .insert(callTasks)
    .values({
      leadId: args.leadId,
      reason: args.reason,
      dueAt: args.dueAt,
      priority: args.priority ?? 0,
      notes: args.notes ?? null,
      agentId: args.agentId ?? null,
      idempotencyKey: args.idempotencyKey ?? null,
    })
    .onConflictDoNothing({ target: callTasks.idempotencyKey })
    .returning();

  // The key was already used: a retry, not a new call.
  if (!row) return { created: false, why: 'already queued' };

  return { created: true, id: row.id };
}

/**
 * The agent has made the call. The outcome becomes a `touches` row — that log,
 * not a counter on the lead, is what the track box counts (mistake: a stored
 * counter drifts the moment anything else touches the lead).
 */
export async function completeCallTask(args: {
  callTaskId: string;
  outcome: CallOutcome;
  notes?: string | null;
}): Promise<{ ok: boolean; leadId?: string }> {
  const [task] = await db
    .select({ id: callTasks.id, leadId: callTasks.leadId, status: callTasks.status })
    .from(callTasks)
    .where(eq(callTasks.id, args.callTaskId))
    .limit(1);

  if (!task || task.status !== 'PENDING') return { ok: false };

  await db
    .update(callTasks)
    .set({ status: 'DONE', outcome: args.outcome, notes: args.notes ?? null, completedAt: new Date() })
    .where(eq(callTasks.id, task.id));

  await db.insert(touches).values({
    leadId: task.leadId,
    channel: 'call',
    direction: 'outbound',
    outcome: args.outcome,
    notes: args.notes ?? null,
  });

  await db
    .update(leads)
    .set({ lastContactAt: new Date(), updatedAt: new Date() })
    .where(eq(leads.id, task.leadId));

  return { ok: true, leadId: task.leadId };
}

/**
 * The calls that exist ONLY because the buyer had gone quiet. A reply makes
 * these moot — there is no point ringing a man to ask why he is not replying
 * while he is replying.
 *
 * Every other reason survives a reply, and that distinction matters: we once
 * cancelled the lot. A buyer asked for the sales head to call, then carried on
 * chatting, and his callback was wiped forty seconds after it was raised. The
 * same happened to HOT_LEAD calls, so the buyers who most needed a human got
 * one only if they stopped talking to us.
 */
export const QUIET_CALL_REASONS = [
  'PHONE_ONLY', 'DELIVERED_UNREAD', 'READ_NO_REPLY', 'CHASE',
] as const satisfies readonly CallReason[];

/**
 * Cancel this lead's open calls. With `onlyReasons`, just those kinds —
 * without it, every one, which is what opting out requires.
 */
export async function cancelPendingCallTasks(
  leadId: string,
  why: string,
  onlyReasons?: readonly CallReason[],
): Promise<number> {
  const cancelled = await db
    .update(callTasks)
    .set({ status: 'CANCELLED', notes: why, completedAt: new Date() })
    .where(and(
      eq(callTasks.leadId, leadId),
      eq(callTasks.status, 'PENDING'),
      ...(onlyReasons ? [inArray(callTasks.reason, [...onlyReasons])] : []),
    ))
    .returning({ id: callTasks.id });

  return cancelled.length;
}

/** Active agents with how many leads each already owns, for round-robin. */
export async function agentsWithLoad() {
  return db
    .select({
      id: agents.id,
      name: agents.name,
      languages: agents.languages,
      openLeads: sql<number>`count(${leads.id})::int`,
    })
    .from(agents)
    .leftJoin(leads, eq(leads.ownerAgentId, agents.id))
    .where(eq(agents.active, true))
    .groupBy(agents.id, agents.name, agents.languages);
}
