import { requireUser } from '@/lib/auth/require';
import { AppShell } from '@/components/app/app-shell';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireUser('/app');
  return <AppShell session={session}>{children}</AppShell>;
}
