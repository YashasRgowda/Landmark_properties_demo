import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requireUser } from '@/lib/auth/require';
import { PageHeader } from '@/components/app/page-header';
import { AddLeadForm } from './add-lead-form';

/** Room for the opening WhatsApp, sent just after the form is saved. */
export const maxDuration = 60;

export const metadata = { title: 'Add a lead · Landmark Lead Desk' };

export default async function NewLeadPage() {
  await requireUser('/app/leads/new');

  return (
    <div className="space-y-6">
      <Link href="/app/leads" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm">
        <ArrowLeft className="size-4" /> All leads
      </Link>
      <PageHeader
        title="Add a lead"
        description="For a walk-in or a phone enquiry. Meera sends them a WhatsApp within a minute. If the number is already here, this is added to their history instead of creating a duplicate."
      />
      <div className="bg-card max-w-xl rounded-2xl border p-6"><AddLeadForm /></div>
    </div>
  );
}
