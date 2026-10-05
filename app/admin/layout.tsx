import { requireAdmin } from '@/lib/auth/require';
import { AppShell } from '@/components/app/app-shell';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin('/admin');
  return <AppShell session={session}>{children}</AppShell>;
}
