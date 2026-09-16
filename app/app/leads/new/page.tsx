import { requireUser } from '@/lib/auth/require';
import { AddLeadForm } from './add-lead-form';

export const metadata = { title: 'Add lead · Landmark System 1' };

export default async function NewLeadPage() {
  await requireUser('/app/leads/new');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Add lead</h1>
        <p className="text-sm text-muted-foreground">
          Same intake path as the portal webhook — an existing phone number adds a touch
          rather than a second lead.
        </p>
      </div>
      <AddLeadForm />
    </div>
  );
}
