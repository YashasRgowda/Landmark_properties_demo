import { and, eq, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { LogOut } from 'lucide-react';
import { db } from '@/lib/db';
import { callTasks, tasks, visits } from '@/lib/db/schema';
import { queueEnv } from '@/lib/queue-policy';
import { logout } from '@/lib/actions/auth';
import type { SessionPayload } from '@/lib/auth/session';
import { Nav, type NavCounts } from './nav';

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <span className="bg-gold text-sidebar-primary-foreground font-display inline-flex size-9 items-center justify-center rounded-lg text-lg font-semibold">
        L
      </span>
      <span className="leading-tight">
        <span className="font-display block text-lg font-semibold">Landmark</span>
        <span className="block text-[11px] tracking-wider uppercase opacity-60">Lead Desk</span>
      </span>
    </div>
  );
}

async function counts(isAdmin: boolean): Promise<NavCounts> {
  const now = new Date();
  const env = queueEnv();
  const [[calls], [unmarked], [failed]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(callTasks)
      .where(and(eq(callTasks.status, 'PENDING'), lte(callTasks.dueAt, now))),
    db.select({ n: sql<number>`count(*)::int` }).from(visits)
      .where(and(eq(visits.status, 'BOOKED'), lt(visits.visitAt, now))),
    isAdmin
      ? db.select({ n: sql<number>`count(*)::int` }).from(tasks).where(and(eq(tasks.status, 'FAILED'),
          env === 'production' ? or(eq(tasks.env, env), isNull(tasks.env)) : eq(tasks.env, env)))
      : Promise.resolve([{ n: 0 }]),
  ]);
  return { calls: calls.n, visits: unmarked.n, failed: failed.n };
}

/** The frame every signed-in page sits in: a green sidebar, the page on ivory. */
export async function AppShell({ session, children }: { session: SessionPayload; children: React.ReactNode }) {
  const isAdmin = session.role === 'admin';
  const c = await counts(isAdmin);

  return (
    <div className="flex min-h-screen">
      <aside className="bg-sidebar text-sidebar-foreground sticky top-0 hidden h-screen w-64 shrink-0 flex-col justify-between p-4 lg:flex">
        <div className="space-y-8">
          <div className="px-2 pt-2"><Brand /></div>
          <Nav isAdmin={isAdmin} counts={c} />
        </div>
        <div className="border-sidebar-border space-y-2 border-t px-2 pt-4">
          <p className="truncate text-xs opacity-70">{session.email}</p>
          <p className="text-[11px] opacity-45">{isAdmin ? 'Admin' : 'Sales agent'}</p>
          <form action={logout}>
            <button className="text-sidebar-foreground/70 hover:text-sidebar-accent-foreground inline-flex items-center gap-2 text-xs">
              <LogOut className="size-3.5" /> Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-sidebar text-sidebar-foreground lg:hidden">
          <div className="flex items-center justify-between p-4">
            <Brand />
            <form action={logout}><button className="text-xs opacity-70">Sign out</button></form>
          </div>
        </header>
        <div className="bg-card border-b lg:hidden"><div className="pt-3"><Nav isAdmin={isAdmin} counts={c} variant="top" /></div></div>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
