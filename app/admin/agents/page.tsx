import { requireAdmin } from '@/lib/auth/require';

export const metadata = { title: 'Agents · Admin' };

export default async function AdminAgentsPage() {
  await requireAdmin('/admin/agents');
  return (
    <div className="space-y-2">
      <h1 className="text-xl font-semibold">Agents</h1>
      <p className="text-sm text-muted-foreground">Editable in Phase 7.</p>
    </div>
  );
}
