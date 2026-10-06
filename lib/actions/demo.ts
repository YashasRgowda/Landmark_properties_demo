'use server';

import { after } from 'next/server';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/require';
import { db } from '@/lib/db';
import { leads } from '@/lib/db/schema';
import { parseIntake } from '@/lib/leads/schema';
import { intakeLead } from '@/lib/leads/intake';
import { getProjectData } from '@/lib/project-data';
import { runDueTasks } from '@/lib/tasks/runner';

export type PortalEnquiryState = {
  errors?: string[];
  /** The number already belongs to a buyer: where to find them. */
  existingLeadId?: string;
  values?: { name: string; phone: string; email: string; message: string };
};

/**
 * The stand-in for 99acres. Until the portal's lead feed is connected, an
 * enquiry typed here goes through the very same intake as the real feed will —
 * same checks, same "one phone, one buyer" rule, same instant WhatsApp — so
 * what is shown in a demo is exactly what will happen with a live portal.
 */
export async function submitPortalEnquiry(_prev: PortalEnquiryState, formData: FormData): Promise<PortalEnquiryState> {
  await requireUser('/app/demo/99acres');

  const values = {
    name: String(formData.get('name') ?? '').trim(),
    phone: String(formData.get('phone') ?? '').trim(),
    email: String(formData.get('email') ?? '').trim(),
    message: String(formData.get('message') ?? '').trim(),
  };

  const project = await getProjectData();
  const parsed = parseIntake({
    name: values.name || null,
    phone: values.phone,
    email: values.email || null,
    source: '99acres',
    project: project.name,
    message: values.message || null,
  });
  if (!parsed.ok) {
    return { errors: ['Please enter a valid 10-digit Indian mobile number.'], values };
  }

  // Each phone number is one buyer. Say so plainly rather than failing silently.
  const [existing] = await db.select({ id: leads.id }).from(leads)
    .where(eq(leads.phone, parsed.value.normalisedPhone)).limit(1);
  if (existing) {
    return {
      errors: ['This number has already enquired, so it is the same buyer — no second WhatsApp is sent. Use another number, or open their page.'],
      existingLeadId: existing.id,
      values,
    };
  }

  let leadId: string;
  try {
    const result = await intakeLead(parsed.value);
    leadId = result.lead.id;
    if (result.created) {
      after(async () => {
        try {
          await runDueTasks(10, { budgetMs: 54_000 });
        } catch (error) {
          console.error('[portal demo] could not send the opening message', error);
        }
      });
    }
  } catch (error) {
    console.error('[portal demo] failed', error);
    return { errors: ['Could not save the enquiry. Try again.'], values };
  }

  redirect(`/app/demo/99acres?lead=${leadId}`);
}
