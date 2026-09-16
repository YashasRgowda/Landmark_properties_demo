import Link from 'next/link';
import { requireUser } from '@/lib/auth/require';
import { logout } from '@/lib/actions/auth';
import { Button } from '@/components/ui/button';

const NAV = [
  { href: '/app', label: 'Today' },
  { href: '/app/leads', label: 'Leads' },
  { href: '/app/calls', label: 'Calls' },
  { href: '/app/visits', label: 'Visits' },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireUser('/app');

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 p-4">
          <span className="font-semibold">Landmark · System 1</span>
          <nav className="flex gap-3 text-sm">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="hover:underline">
                {item.label}
              </Link>
            ))}
            {session.role === 'admin' ? (
              <Link href="/admin/project" className="hover:underline">
                Admin
              </Link>
            ) : null}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">{session.email}</span>
            <form action={logout}>
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4">{children}</main>
    </div>
  );
}
