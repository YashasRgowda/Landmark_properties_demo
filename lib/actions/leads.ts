'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/require';
import { parseIntake } from '@/lib/leads/schema';
import { intakeLead } from '@/lib/leads/intake';

export type AddLeadState = {
  errors?: string[];
  warnings?: string[];
};

/**
 * The manual "Add lead" form. Runs the identical intake path as the webhook,
 * so dedupe behaves the same whether a lead arrives from 99acres or a keyboard.
 */
export async function addLead(_prev: AddLeadState, formData: FormData): Promise<AddLeadState> {
  await requireUser('/app/leads/new');

  const parsed = parseIntake({
    name: formData.get('name') || null,
    phone: formData.get('phone') || '',
    email: formData.get('email') || null,
    source: formData.get('source') || '',
    campaign: formData.get('campaign') || null,
    project: formData.get('project') || null,
  });

  if (!parsed.ok) return { errors: parsed.errors };

  let leadId: string;
  try {
    const result = await intakeLead(parsed.value);
    leadId = result.lead.id;
  } catch (error) {
    console.error('[addLead] failed', error);
    return { errors: ['Could not save the lead. Try again.'] };
  }

  revalidatePath('/app/leads');
  redirect(`/app/leads?highlight=${leadId}`);
}
