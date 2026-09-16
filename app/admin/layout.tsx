import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/require';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin('/admin');

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center gap-4 p-4 text-sm">
          <span className="font-semibold">Admin</span>
          <Link href="/admin/project" className="hover:underline">
            Project data
          </Link>
          <Link href="/admin/agents" className="hover:underline">
            Agents
          </Link>
          <Link href="/app" className="ml-auto hover:underline">
            Back to app
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4">{children}</main>
    </div>
  );
}
