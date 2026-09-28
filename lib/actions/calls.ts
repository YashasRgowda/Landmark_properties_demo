'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/require';
import { completeCallTask } from '@/lib/calls/create';
import { afterCallOutcome } from '@/lib/chase-engine';
import { CALL_OUTCOMES, type CallOutcome } from '@/lib/db/schema';

export type MarkCallState = { error?: string; done?: boolean };

/**
 * The agent has rung the buyer. Recording the outcome closes the call task and
 * writes the `touches` row that the lead's history is counted from.
 */
export async function markCallOutcome(
  _prev: MarkCallState,
  formData: FormData,
): Promise<MarkCallState> {
  await requireUser('/app/calls');

  const callTaskId = String(formData.get('callTaskId') ?? '');
  const outcome = String(formData.get('outcome') ?? '');
  const notes = String(formData.get('notes') ?? '').trim() || null;

  if (!callTaskId) return { error: 'No call was selected.' };
  if (!(CALL_OUTCOMES as readonly string[]).includes(outcome)) {
    return { error: 'Choose what happened on the call.' };
  }

  const result = await completeCallTask({
    callTaskId,
    outcome: outcome as CallOutcome,
    notes,
  });

  if (!result.ok) return { error: 'That call has already been closed by someone else.' };

  if (result.leadId) await afterCallOutcome(result.leadId, outcome as CallOutcome);

  revalidatePath('/app/calls');
  revalidatePath('/app');
  if (result.leadId) revalidatePath(`/app/leads/${result.leadId}`);
  return { done: true };
}
