'use server';

import { and, desc, eq, inArray } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/require';
import { db } from '@/lib/db';
import { agents, callTasks, leads, messages, tasks, type WaState } from '@/lib/db/schema';
import { intakeLead } from '@/lib/leads/intake';
import { parseIntake } from '@/lib/leads/schema';
import { runDueTasks } from '@/lib/tasks/runner';

/**
 * The first-hour ladder simulator behind /app/debug/ladder.
 *
 * It runs the REAL CHECK_DELIVERY handler, the real decision table and the real
 * call-task rules, so what appears on /app/calls afterwards is exactly what a
 * live lead would produce. Two things are simulated, both clearly labelled:
 * the WhatsApp itself is not delivered, and Meta's delivery receipt is set by
 * hand instead of arriving as a webhook.
 *
 * Development only.
 */

function guard() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The ladder simulator is not available in production.');
  }
}

/** Reserved numbers, one per scenario, so results never collide. */
const SCENARIOS = {
  NOT_ON_WHATSAPP: { phone: '919000000201', name: 'Test · No WhatsApp' },
  DELIVERED: { phone: '919000000202', name: 'Test · Did not open' },
  READ: { phone: '919000000203', name: 'Test · Read, ignored' },
  REPLIED: { phone: '919000000204', name: 'Test · Replied' },
} as const;

export type ScenarioKey = keyof typeof SCENARIOS;

export type LadderRow = {
  scenario: ScenarioKey;
  label: string;
  phone: string;
  leadId: string | null;
  leadStatus: string | null;
  waState: string | null;
  messageSent: boolean;
  call: {
    reason: string;
    priority: number;
    dueAt: Date;
    minutesFromNow: number;
    notes: string | null;
    agentName: string | null;
  } | null;
};

const LABELS: Record<ScenarioKey, string> = {
  NOT_ON_WHATSAPP: 'Not on WhatsApp at all',
  DELIVERED: 'Message delivered, never opened',
  READ: 'He opened it and did not reply',
  REPLIED: 'He replied',
};

export async function getLadderState(): Promise<LadderRow[]> {
  await requireAdmin('/app/debug/ladder');
  guard();

  const phones = Object.values(SCENARIOS).map((s) => s.phone);
  const rows = await db.select().from(leads).where(inArray(leads.phone, phones));
  const byPhone = new Map(rows.map((l) => [l.phone, l]));

  const leadIds = rows.map((l) => l.id);
  const calls = leadIds.length
    ? await db
        .select({
          leadId: callTasks.leadId,
          reason: callTasks.reason,
          priority: callTasks.priority,
          dueAt: callTasks.dueAt,
          notes: callTasks.notes,
          agentName: agents.name,
        })
        .from(callTasks)
        .leftJoin(agents, eq(agents.id, callTasks.agentId))
        .where(and(inArray(callTasks.leadId, leadIds), eq(callTasks.status, 'PENDING')))
        .orderBy(desc(callTasks.dueAt))
    : [];

  const sent = leadIds.length
    ? await db
        .select({ leadId: messages.leadId })
        .from(messages)
        .where(and(inArray(messages.leadId, leadIds), eq(messages.direction, 'outbound')))
    : [];
  const hasMessage = new Set(sent.map((m) => m.leadId));

  return (Object.keys(SCENARIOS) as ScenarioKey[]).map((key) => {
    const { phone } = SCENARIOS[key];
    const lead = byPhone.get(phone);
    const call = lead ? calls.find((c) => c.leadId === lead.id) : undefined;

    return {
      scenario: key,
      label: LABELS[key],
      phone,
      leadId: lead?.id ?? null,
      leadStatus: lead?.status ?? null,
      waState: lead?.waState ?? null,
      messageSent: lead ? hasMessage.has(lead.id) : false,
      call: call
        ? {
            reason: call.reason,
            priority: call.priority,
            dueAt: call.dueAt,
            minutesFromNow: Math.round((call.dueAt.getTime() - Date.now()) / 60_000),
            notes: call.notes,
            agentName: call.agentName,
          }
        : null,
    };
  });
}

/**
 * Run one scenario from arrival to call task, in a single click.
 *
 * Every step below is the real one except where it says otherwise.
 */
export async function runScenario(scenario: ScenarioKey): Promise<LadderRow[]> {
  await requireAdmin('/app/debug/ladder');
  guard();

  const { phone, name } = SCENARIOS[scenario];

  // Start clean so a re-run means the same thing every time.
  await db.delete(leads).where(eq(leads.phone, phone));

  // 1. The real intake path — the same one a 99acres POST goes through.
  //    This queues SEND_FIRST_MESSAGE.
  const parsed = parseIntake({ name, phone, source: '99acres', project: 'Ashraya' });
  if (!parsed.ok) throw new Error(`ladder: ${parsed.errors.join(', ')}`);
  const { lead } = await intakeLead(parsed.value);

  // 2. SIMULATED: the opening WhatsApp. Locally there is no Meta to deliver it,
  //    so it is recorded as sent rather than actually sent. Everything after
  //    this point is the real code.
  await db.delete(tasks).where(and(eq(tasks.leadId, lead.id), eq(tasks.type, 'SEND_FIRST_MESSAGE')));
  await db.insert(messages).values({
    leadId: lead.id,
    direction: 'outbound',
    body: '[template: opening message]',
    templateName: 'opening',
    status: 'sent',
  });

  // 3. SIMULATED: Meta's delivery receipt. Live, this arrives as a webhook.
  await db
    .update(leads)
    .set({
      status: 'MESSAGE_SENT',
      waState: scenario as WaState,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, lead.id));

  // 4. REAL: the two-minute delivery check, brought forward so nobody waits.
  await db.insert(tasks).values({
    leadId: lead.id,
    type: 'CHECK_DELIVERY',
    dueAt: new Date(Date.now() - 1000),
    idempotencyKey: `ladder:check:${lead.id}:${Date.now()}`,
  });

  await runDueTasks(20);

  return getLadderState();
}

/** Pretend the agent's 10 or 15 minutes have already passed. */
export async function fastForwardCalls(): Promise<LadderRow[]> {
  await requireAdmin('/app/debug/ladder');
  guard();

  const phones = Object.values(SCENARIOS).map((s) => s.phone);
  const rows = await db.select({ id: leads.id }).from(leads).where(inArray(leads.phone, phones));
  if (rows.length > 0) {
    await db
      .update(callTasks)
      .set({ dueAt: new Date(Date.now() - 60_000) })
      .where(and(inArray(callTasks.leadId, rows.map((r) => r.id)), eq(callTasks.status, 'PENDING')));
  }
  return getLadderState();
}

export async function resetLadder(): Promise<LadderRow[]> {
  await requireAdmin('/app/debug/ladder');
  guard();

  const phones = Object.values(SCENARIOS).map((s) => s.phone);
  await db.delete(leads).where(inArray(leads.phone, phones));
  return getLadderState();
}

