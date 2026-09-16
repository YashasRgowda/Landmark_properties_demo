'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { addLead, type AddLeadState } from '@/lib/actions/leads';
import { LEAD_SOURCES } from '@/lib/db/schema';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const initialState: AddLeadState = {};

export function AddLeadForm() {
  const [state, formAction, pending] = useActionState(addLead, initialState);

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      <div className="space-y-2">
        <Label htmlFor="phone">Phone *</Label>
        <Input id="phone" name="phone" required autoFocus placeholder="+91 98765 43210" />
        <p className="text-xs text-muted-foreground">
          Any format. Stored as 91XXXXXXXXXX.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="source">Source *</Label>
        <select
          id="source"
          name="source"
          required
          defaultValue="99acres"
          className="border-input bg-background flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs"
        >
          {LEAD_SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="project">Project</Label>
          <Input id="project" name="project" defaultValue="Ashraya" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="campaign">Campaign</Label>
          <Input id="campaign" name="campaign" />
        </div>
      </div>

      {state.errors?.length ? (
        <ul role="alert" className="space-y-1 text-sm text-destructive">
          {state.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Add lead'}
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link href="/app/leads">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
