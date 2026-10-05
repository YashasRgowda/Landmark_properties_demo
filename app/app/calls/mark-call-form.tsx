'use client';

import { useActionState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { markCallOutcome, type MarkCallState } from '@/lib/actions/calls';
import { Input } from '@/components/ui/input';

/**
 * How did the call go? One tap, plus an optional note. Each choice says what
 * the system will do next, so nobody has to guess what a button means.
 */
const OUTCOMES = [
  { value: 'ANSWERED', label: 'Spoke to them', hint: 'Follow-ups stop' },
  { value: 'NO_ANSWER', label: 'No answer', hint: "We'll keep trying" },
  { value: 'BUSY', label: 'Busy', hint: "We'll keep trying" },
  { value: 'CALLBACK_REQUESTED', label: 'Call back later', hint: 'Booked in 3 hours' },
  { value: 'NOT_INTERESTED', label: 'Not interested', hint: 'Closes the lead' },
  { value: 'WRONG_NUMBER', label: 'Wrong number', hint: 'Closes the lead' },
];

export function MarkCallForm({ callTaskId }: { callTaskId: string }) {
  const [state, action, pending] = useActionState<MarkCallState, FormData>(markCallOutcome, {});

  if (state.done) {
    return (
      <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        <CheckCircle2 className="size-4" /> Saved. The next step happens automatically.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-2 border-t pt-4">
      <input type="hidden" name="callTaskId" value={callTaskId} />
      <p className="text-muted-foreground text-xs font-medium">After the call — how did it go?</p>
      <Input name="notes" placeholder="Anything worth remembering? (optional, type before tapping)" className="h-9" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {OUTCOMES.map((o) => (
          <button key={o.value} type="submit" name="outcome" value={o.value} disabled={pending}
            className="hover:border-primary/40 hover:bg-secondary rounded-xl border px-2.5 py-2 text-left transition disabled:opacity-50">
            <span className="block text-sm font-medium">{o.label}</span>
            <span className="text-muted-foreground block text-[11px]">{o.hint}</span>
          </button>
        ))}
      </div>
      {state.error && <p className="text-destructive text-sm">{state.error}</p>}
    </form>
  );
}
