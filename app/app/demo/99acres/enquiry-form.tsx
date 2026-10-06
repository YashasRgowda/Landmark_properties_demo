'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Send } from 'lucide-react';
import { submitPortalEnquiry, type PortalEnquiryState } from '@/lib/actions/demo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const QUESTIONS = [
  'I am interested in this project. Please share details.',
  'Please share the price list and available plot sizes.',
  'I would like to visit the site this weekend.',
  'Is this project bank-loan approved?',
];

export function EnquiryForm() {
  const [state, action, pending] = useActionState<PortalEnquiryState, FormData>(submitPortalEnquiry, {});
  const v = state.values;

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="name">Your name</Label>
          <Input id="name" name="name" defaultValue={v?.name} placeholder="e.g. Suresh Rao" autoComplete="off" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Mobile number</Label>
          <div className="flex">
            <span className="border-input bg-muted text-muted-foreground inline-flex items-center rounded-l-md border border-r-0 px-2.5 text-sm">+91</span>
            <Input id="phone" name="phone" required defaultValue={v?.phone} placeholder="98765 43210"
              inputMode="tel" autoComplete="off" className="rounded-l-none" />
          </div>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email <span className="text-muted-foreground font-normal">(optional)</span></Label>
        <Input id="email" name="email" type="email" defaultValue={v?.email} autoComplete="off" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="message">Message to the builder</Label>
        <select id="message" name="message" defaultValue={v?.message || QUESTIONS[0]}
          className="border-input bg-card flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs">
          {QUESTIONS.map((q) => <option key={q} value={q}>{q}</option>)}
        </select>
      </div>

      {state.errors && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {state.errors.join(' ')}{' '}
          {state.existingLeadId && (
            <Link href={`/app/leads/${state.existingLeadId}`} className="font-medium underline">Open their page</Link>
          )}
        </div>
      )}

      <Button type="submit" size="lg" disabled={pending} className="w-full">
        <Send className="size-4" /> {pending ? 'Sending enquiry…' : 'Contact builder'}
      </Button>
      <p className="text-muted-foreground text-center text-xs">
        By contacting, the buyer agrees to be contacted on WhatsApp and phone — exactly as on the portal.
      </p>
    </form>
  );
}
