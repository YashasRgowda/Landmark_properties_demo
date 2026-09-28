'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/require';
import { db } from '@/lib/db';
import { agents, callTasks, leads } from '@/lib/db/schema';
import { normalisePhone } from '@/lib/phone';
import { AGENT_LANGUAGES, type AgentLanguage } from '@/lib/agents/languages';

export type AgentFormState = { errors?: string[]; added?: string };

/** Add a salesperson. Hot leads are matched to agents by language. */
export async function addAgent(_prev: AgentFormState, formData: FormData): Promise<AgentFormState> {
  await requireAdmin('/admin/agents');

  const name = String(formData.get('name') ?? '').trim();
  const phoneRaw = String(formData.get('phone') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim().toLowerCase() || null;
  const languages = formData.getAll('languages').map(String)
    .filter((l): l is AgentLanguage => (AGENT_LANGUAGES as readonly string[]).includes(l));

  const errors: string[] = [];
  if (!name) errors.push('Name is required.');
  if (languages.length === 0) errors.push('Pick at least one language he or she can sell in.');
  const phone = phoneRaw ? normalisePhone(phoneRaw) : null;
  if (phoneRaw && !phone) errors.push('That phone number is not a valid Indian number.');
  if (email && !/^\S+@\S+\.\S+$/.test(email)) errors.push('That email address does not look right.');
  if (email) {
    const [taken] = await db.select({ id: agents.id }).from(agents).where(eq(agents.email, email)).limit(1);
    if (taken) errors.push('An agent with that email already exists.');
  }
  if (errors.length) return { errors };

  await db.insert(agents).values({ name, phone, email, languages, active: true });
  revalidatePath('/admin/agents');
  return { added: name };
}

/**
 * Deactivate or bring back an agent. Deactivating hands their open leads and
 * waiting calls back to the team, so nothing sits with someone who has left.
 * The last active agent cannot be deactivated: with nobody on the roster, a
 * hot lead would have no one to go to.
 */
export async function setAgentActive(formData: FormData): Promise<void> {
  await requireAdmin('/admin/agents');
  const agentId = String(formData.get('agentId') ?? '');
  const active = formData.get('active') === 'true';
  if (!agentId) return;

  if (!active) {
    const others = await db.select({ id: agents.id }).from(agents)
      .where(and(eq(agents.active, true), ne(agents.id, agentId))).limit(1);
    if (others.length === 0) return; // the page explains why the button is not offered

    await db
      .update(leads)
      .set({ ownerAgentId: null, updatedAt: new Date() })
      .where(and(eq(leads.ownerAgentId, agentId), inArray(leads.status,
        ['NEW', 'MESSAGE_SENT', 'NOT_ON_WHATSAPP', 'DELIVERED_UNREAD', 'READ_NO_REPLY',
         'CHATTING', 'QUALIFIED', 'WITH_AGENT', 'VISIT_BOOKED', 'VISITED'])));
    await db
      .update(callTasks)
      .set({ agentId: null })
      .where(and(eq(callTasks.agentId, agentId), eq(callTasks.status, 'PENDING')));
  }

  await db.update(agents).set({ active }).where(eq(agents.id, agentId));
  revalidatePath('/admin/agents');
}
