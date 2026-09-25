'use client';

import { useActionState } from 'react';
import { markCallOutcome, type MarkCallState } from '@/lib/actions/calls';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * What happened on the call. Deliberately one click plus optional notes — an
 * agent between calls will not fill in a form, and an outcome nobody records is
 * a lead nobody chases.
 */
const OUTCOMES: { value: string; label: string }[] = [
  { value: 'ANSWERED', label: 'Answered' },
  { value: 'NO_ANSWER', label: 'No answer' },
  { value: 'BUSY', label: 'Busy' },
  { value: 'CALLBACK_REQUESTED', label: 'Call back later' },
  { value: 'WRONG_NUMBER', label: 'Wrong number' },
  { value: 'NOT_INTERESTED', label: 'Not interested' },
];

export function MarkCallForm({ callTaskId }: { callTaskId: string }) {
  const [state, action, pending] = useActionState<MarkCallState, FormData>(markCallOutcome, {});

  if (state.done) {
    return <p className="text-muted-foreground text-sm">Saved. It will drop off this list.</p>;
  }

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="callTaskId" value={callTaskId} />
      <Input name="notes" placeholder="Notes (optional)" className="h-9" />
      <div className="flex flex-wrap gap-2">
        {OUTCOMES.map((o) => (
          <Button
            key={o.value}
            type="submit"
            name="outcome"
            value={o.value}
            variant="outline"
            size="sm"
            disabled={pending}
          >
            {o.label}
          </Button>
        ))}
      </div>
      {state.error && <p className="text-destructive text-sm">{state.error}</p>}
    </form>
  );
}
