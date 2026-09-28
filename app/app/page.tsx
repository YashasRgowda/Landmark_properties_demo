import Link from 'next/link';
import { and, asc, desc, eq, gte, isNull, lt, lte, notInArray, or, sql } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/require';
import { db } from '@/lib/db';
import { agents, callTasks, chaseStates, leads, tasks, visits } from '@/lib/db/schema';
import { formatPhone } from '@/lib/phone';
import { formatIST } from '@/lib/format';
import { describeVisit, fromIst, istParts } from '@/lib/visit-time';
import { checkLeadDrought } from '@/lib/lead-drought-check';
import { queueEnv } from '@/lib/queue-policy';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata = { title: 'Today · Landmark System 1' };
export const dynamic = 'force-dynamic';

const DAY = 24 * 60 * 60_000;
const CLOSED = ['WON', 'LOST', 'REJECTED'];

/**
 * What needs doing today, on one screen. Every number links to the list behind
 * it; nothing here is a stored counter — all of it is worked out from the
 * records as they stand.
 */
export default async function TodayPage() {
  const session = await requireUser('/app');

  const now = new Date();
  const t = istParts(now);
  const startOfToday = fromIst(t.year, t.month, t.day, 0, 0);
  const startOfTomorrow = new Date(startOfToday.getTime() + DAY);

  const [newToday, hot, callsDue, visitsToday, lateStage, unmarked, running] = await Promise.all([
    db.select({ id: leads.id, name: leads.name, phone: leads.phone, source: leads.source,
      status: leads.status, createdAt: leads.createdAt })
      .from(leads).where(gte(leads.createdAt, startOfToday)).orderBy(desc(leads.createdAt)).limit(8),

    db.select({ id: leads.id, name: leads.name, phone: leads.phone, score: leads.score,
      nextAction: leads.nextAction, nextActionAt: leads.nextActionAt, owner: agents.name })
      .from(leads).leftJoin(agents, eq(agents.id, leads.ownerAgentId))
      .where(and(eq(leads.category, 'HOT'), notInArray(leads.status, CLOSED)))
      .orderBy(desc(leads.updatedAt)).limit(8),

    db.select({ id: callTasks.id, reason: callTasks.reason, priority: callTasks.priority, dueAt: callTasks.dueAt,
      leadId: leads.id, name: leads.name, phone: leads.phone })
      .from(callTasks).innerJoin(leads, eq(leads.id, callTasks.leadId))
      .where(and(eq(callTasks.status, 'PENDING'), lte(callTasks.dueAt, now)))
      .orderBy(desc(callTasks.priority), asc(callTasks.dueAt)).limit(8),

    db.select({ id: visits.id, visitAt: visits.visitAt, leadId: leads.id, name: leads.name, phone: leads.phone })
      .from(visits).innerJoin(leads, eq(leads.id, visits.leadId))
      .where(and(eq(visits.status, 'BOOKED'), gte(visits.visitAt, startOfToday), lt(visits.visitAt, startOfTomorrow)))
      .orderBy(asc(visits.visitAt)),

    db.select({ leadId: leads.id, name: leads.name, phone: leads.phone, owner: agents.name, dueAt: callTasks.dueAt })
      .from(callTasks).innerJoin(leads, eq(leads.id, callTasks.leadId))
      .leftJoin(agents, eq(agents.id, callTasks.agentId))
      .where(and(eq(callTasks.status, 'PENDING'), eq(callTasks.reason, 'LATE_STAGE'))),

    db.select({ n: sql<number>`count(*)::int` }).from(visits)
      .where(and(eq(visits.status, 'BOOKED'), lt(visits.visitAt, now))),

    db.select({ n: sql<number>`count(*)::int` }).from(chaseStates).where(eq(chaseStates.status, 'ACTIVE')),
  ]);

  // The lists show a handful; the numbers count everything.
  const [[newCount], [hotCount], [dueCount]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(leads).where(gte(leads.createdAt, startOfToday)),
    db.select({ n: sql<number>`count(*)::int` }).from(leads)
      .where(and(eq(leads.category, 'HOT'), notInArray(leads.status, CLOSED))),
    db.select({ n: sql<number>`count(*)::int` }).from(callTasks)
      .where(and(eq(callTasks.status, 'PENDING'), lte(callTasks.dueAt, now))),
  ]);

  const drought = await checkLeadDrought(now);
  const [failedJobs] = session.role === 'admin'
    ? await db.select({ n: sql<number>`count(*)::int` }).from(tasks).where(and(eq(tasks.status, 'FAILED'),
        queueEnv() === 'production' ? or(eq(tasks.env, 'production'), isNull(tasks.env)) : eq(tasks.env, queueEnv())))
    : [{ n: 0 }];
  const who = (name: string | null, phone: string) => name?.trim() || formatPhone(phone);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Today</h1>
        <p className="text-muted-foreground text-sm">
          {formatIST(now, "EEEE d MMMM, h:mm a")} · signed in as {session.email}
        </p>
      </div>

      {failedJobs.n > 0 && (
        <p className="border-destructive/50 bg-destructive/10 rounded-md border p-3 text-sm">
          <Link href="/app/debug/failed" className="underline">
            {failedJobs.n} job{failedJobs.n === 1 ? ' has' : 's have'} failed for good — see what and why
          </Link>
        </p>
      )}

      {drought && (
        <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">{drought.message}</p>
      )}

      {lateStage.length > 0 && (
        <div className="space-y-1 rounded-md border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
          <p className="font-medium">
            {lateStage.length} buyer{lateStage.length === 1 ? ' was' : 's were'} close to buying and went quiet — ring today
          </p>
          {lateStage.map((l) => (
            <p key={l.leadId}>
              <Link href={`/app/leads/${l.leadId}`} className="hover:underline">{who(l.name, l.phone)}</Link>
              {' · '}{l.owner ?? 'no owner yet'}
            </p>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Calls due now" value={dueCount.n} href="/app/calls" urgent={dueCount.n > 0} />
        <Stat label="Hot leads" value={hotCount.n} href="/app/leads?category=HOT" />
        <Stat label="Visits today" value={visitsToday.length} href="/app/visits" />
        <Stat label="New today" value={newCount.n} href="/app/leads" />
        <Stat label="Follow-ups running" value={running[0]?.n ?? 0} href="/app/leads" />
      </div>

      {(unmarked[0]?.n ?? 0) > 0 && (
        <p className="text-sm">
          <Link href="/app/visits" className="underline">
            {unmarked[0].n} past visit{unmarked[0].n === 1 ? '' : 's'} still need{unmarked[0].n === 1 ? 's' : ''} marking — did he come?
          </Link>
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Calls due now" href="/app/calls" empty="No calls due. Nice.">
          {callsDue.map((c) => (
            <Line key={c.id} href={`/app/leads/${c.leadId}`} main={who(c.name, c.phone)}
              side={<>{c.priority >= 10 && <Badge>Top</Badge>} <span>{c.reason.replace(/_/g, ' ').toLowerCase()}</span></>} />
          ))}
        </Panel>

        <Panel title="Visits today" href="/app/visits" empty="No visits today.">
          {visitsToday.map((v) => (
            <Line key={v.id} href={`/app/leads/${v.leadId}`} main={who(v.name, v.phone)}
              side={describeVisit(v.visitAt).split(' at ')[1]} />
          ))}
        </Panel>

        <Panel title="Hot leads" href="/app/leads?category=HOT" empty="No hot leads right now.">
          {hot.map((h) => (
            <Line key={h.id} href={`/app/leads/${h.id}`} main={<>{who(h.name, h.phone)} <span className="text-muted-foreground">· {h.score}</span></>}
              side={h.owner ?? 'no owner'} />
          ))}
        </Panel>

        <Panel title="New today" href="/app/leads" empty="No new leads yet today.">
          {newToday.map((n) => (
            <Line key={n.id} href={`/app/leads/${n.id}`} main={who(n.name, n.phone)}
              side={`${n.source} · ${formatIST(n.createdAt, 'h:mm a')}`} />
          ))}
        </Panel>
      </div>
    </div>
  );
}

function Stat({ label, value, href, urgent }: { label: string; value: number; href: string; urgent?: boolean }) {
  return (
    <Link href={href} className={`rounded-md border p-3 hover:bg-muted/50 ${urgent ? 'border-amber-500/60' : ''}`}>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-muted-foreground text-xs">{label}</p>
    </Link>
  );
}

function Panel({ title, href, empty, children }: {
  title: string; href: string; empty: string; children: React.ReactNode;
}) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <Link href={href} className="text-muted-foreground text-xs hover:underline">See all →</Link>
      </CardHeader>
      <CardContent className="space-y-1">
        {items.length ? items : <p className="text-muted-foreground text-sm">{empty}</p>}
      </CardContent>
    </Card>
  );
}

function Line({ href, main, side }: { href: string; main: React.ReactNode; side: React.ReactNode }) {
  return (
    <Link href={href} className="hover:bg-muted/50 flex items-center justify-between gap-3 rounded px-1 py-1 text-sm">
      <span>{main}</span>
      <span className="text-muted-foreground flex items-center gap-1 text-xs">{side}</span>
    </Link>
  );
}
