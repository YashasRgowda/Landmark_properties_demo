import { requireAdmin } from '@/lib/auth/require';

export const metadata = { title: 'Project data · Admin' };

export default async function AdminProjectPage() {
  await requireAdmin('/admin/project');
  return (
    <div className="space-y-2">
      <h1 className="text-xl font-semibold">Project data</h1>
      <p className="text-sm text-muted-foreground">Editable in Phase 7.</p>
    </div>
  );
}
