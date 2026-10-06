import Link from 'next/link';
import { and, asc, desc, eq, gte, isNull, lt, lte, notInArray, or, sql } from 'drizzle-orm';
import {
  AlertTriangle, CalendarCheck, Flame, PhoneCall, Repeat, Sparkles, UserPlus,
} from 'lucide-react';
import { requireUser } from '@/lib/auth/require';
import { db } from '@/lib/db';
import { agents, callTasks, chaseStates, leads, tasks, visits } from '@/lib/db/schema';
import { formatIST } from '@/lib/format';
import { describeVisit, fromIst, istParts } from '@/lib/visit-time';
import { checkLeadDrought } from '@/lib/lead-drought-check';
import { queueEnv } from '@/lib/queue-policy';
import { callReason, greeting, relativeTime, sourceName } from '@/lib/labels';
import { PageHeader } from '@/components/app/page-header';
import { Empty, Panel, StatCard } from '@/components/app/panel';
import { LeadIdentity } from '@/components/app/lead-identity';
import { Pill } from '@/components/app/pill';
import { LiveRefresh } from '@/components/app/live-refresh';

export const metadata = { title: 'Today · Landmark Lead Desk' };
export const dynamic = 'force-dynamic';

const DAY = 24 * 60 * 60_000;
const CLOSED = ['WON', 'LOST', 'REJECTED'];

/**
 * What needs doing today, on one screen, in plain words. Every number is
 * counted from the records as they stand, and links to the list behind it.
 */
export default async function TodayPage() {
  const session = await requireUser('/app');
  const isAdmin = session.role === 'admin';

  const now = new Date();
  const t = istParts(now);
  const startOfToday = fromIst(t.year, t.month, t.day, 0, 0);
  const startOfTomorrow = new Date(startOfToday.getTime() + DAY);
  const env = queueEnv();

  const [callsDue, visitsToday, hot, newToday, lateStage] = await Promise.all([
    db.select({ id: callTasks.id, reason: callTasks.reason, priority: callTasks.priority, dueAt: callTasks.dueAt,
      leadId: leads.id, name: leads.name, phone: leads.phone })
      .from(callTasks).innerJoin(leads, eq(leads.id, callTasks.leadId))
      .where(and(eq(callTasks.status, 'PENDING'), lte(callTasks.dueAt, now)))
      .orderBy(desc(callTasks.priority), asc(callTasks.dueAt)).limit(6),
    db.select({ id: visits.id, visitAt: visits.visitAt, leadId: leads.id, name: leads.name, phone: leads.phone })
      .from(visits).innerJoin(leads, eq(leads.id, visits.leadId))
      .where(and(eq(visits.status, 'BOOKED'), gte(visits.visitAt, startOfToday), lt(visits.visitAt, startOfTomorrow)))
      .orderBy(asc(visits.visitAt)),
    db.select({ id: leads.id, name: leads.name, phone: leads.phone, summary: leads.summary, owner: agents.name })
      .from(leads).leftJoin(agents, eq(agents.id, leads.ownerAgentId))
      .where(and(eq(leads.category, 'HOT'), notInArray(leads.status, CLOSED)))
      .orderBy(desc(leads.updatedAt)).limit(5),
    db.select({ id: leads.id, name: leads.name, phone: leads.phone, source: leads.source, createdAt: leads.createdAt })
      .from(leads).where(gte(leads.createdAt, startOfToday)).orderBy(desc(leads.createdAt)).limit(5),
    db.select({ leadId: leads.id, name: leads.name, phone: leads.phone, owner: agents.name })
      .from(callTasks).innerJoin(leads, eq(leads.id, callTasks.leadId))
      .leftJoin(agents, eq(agents.id, callTasks.agentId))
      .where(and(eq(callTasks.status, 'PENDING'), eq(callTasks.reason, 'LATE_STAGE'))),
  ]);

  const count = (q: Promise<{ n: number }[]>) => q.then((r) => r[0]?.n ?? 0);
  const [dueCount, hotCount, newCount, followCount, unmarked, failedJobs, drought] = await Promise.all([
    count(db.select({ n: sql<number>`count(*)::int` }).from(callTasks)
      .where(and(eq(callTasks.status, 'PENDING'), lte(callTasks.dueAt, now)))),
    count(db.select({ n: sql<number>`count(*)::int` }).from(leads)
      .where(and(eq(leads.category, 'HOT'), notInArray(leads.status, CLOSED)))),
    count(db.select({ n: sql<number>`count(*)::int` }).from(leads).where(gte(leads.createdAt, startOfToday))),
    count(db.select({ n: sql<number>`count(*)::int` }).from(chaseStates).where(eq(chaseStates.status, 'ACTIVE'))),
    count(db.select({ n: sql<number>`count(*)::int` }).from(visits)
      .where(and(eq(visits.status, 'BOOKED'), lt(visits.visitAt, now)))),
    isAdmin
      ? count(db.select({ n: sql<number>`count(*)::int` }).from(tasks).where(and(eq(tasks.status, 'FAILED'),
          env === 'production' ? or(eq(tasks.env, env), isNull(tasks.env)) : eq(tasks.env, env))))
      : Promise.resolve(0),
    checkLeadDrought(now),
  ]);

  // One sentence that says what today needs.
  const todo = [
    dueCount && `${dueCount} call${dueCount === 1 ? '' : 's'} to make`,
    visitsToday.length && `${visitsToday.length} site visit${visitsToday.length === 1 ? '' : 's'} today`,
    hotCount && `${hotCount} hot buyer${hotCount === 1 ? '' : 's'}`,
  ].filter(Boolean) as string[];
  const summary = todo.length
    ? `You have ${todo.length > 1 ? `${todo.slice(0, -1).join(', ')} and ${todo.at(-1)}` : todo[0]}.`
    : 'All clear — nothing needs you right now. Meera is answering every enquiry.';

  return (
    <div className="space-y-8">
      <LiveRefresh every={15000} />
      <PageHeader eyebrow={formatIST(now, 'EEEE, d MMMM')} title={greeting(now)} description={summary} />

      <div className="space-y-3 empty:hidden">
        {lateStage.length > 0 && (
          <Callout tone="hot" icon={Flame} href={`/app/leads/${lateStage[0].leadId}`} action="Open">
            <strong>{lateStage.map((l) => l.name?.trim() || 'A buyer').join(', ')}</strong>{' '}
            {lateStage.length === 1 ? 'was' : 'were'} about to buy and went quiet. Ring today
            {lateStage[0].owner ? ` — ${lateStage[0].owner} is handling this` : ''}.
          </Callout>
        )}
        {unmarked > 0 && (
          <Callout tone="gold" icon={CalendarCheck} href="/app/visits" action="Mark them">
            {`${unmarked} site ${unmarked === 1 ? 'visit has' : 'visits have'} passed. Tell us who came, so the right follow-up starts.`}
          </Callout>
        )}
        {failedJobs > 0 && (
          <Callout tone="bad" icon={AlertTriangle} href="/app/debug/failed" action="See what">
            {failedJobs} background job{failedJobs === 1 ? '' : 's'} could not finish, even after retrying.
          </Callout>
        )}
        {drought && <Callout tone="gold" icon={AlertTriangle}>{drought.message}</Callout>}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Calls to make" value={dueCount} hint="People to ring right now" href="/app/calls" icon={PhoneCall} tone="urgent" />
        <StatCard label="Hot buyers" value={hotCount} hint="Ready to buy soon" href="/app/leads?category=HOT" icon={Flame} />
        <StatCard label="Visits today" value={visitsToday.length} hint="Coming to the site" href="/app/visits" icon={CalendarCheck} />
        <StatCard label="New leads" value={newCount} hint="Arrived today" href="/app/leads" icon={UserPlus} />
        <StatCard label="Being followed up" value={followCount} hint="Gone quiet — on autopilot" href="/app/leads" icon={Repeat} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Call these people now" description="Most urgent first. Tap a number to ring." href="/app/calls"
          linkLabel="All calls" icon={PhoneCall} tone={dueCount ? 'urgent' : undefined}>
          {callsDue.length ? (
            <ul className="divide-y">
              {callsDue.map((c) => {
                const r = callReason(c.reason);
                return (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-3">
                    <LeadIdentity id={c.leadId} name={c.name} phone={c.phone} />
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Pill tone={r.tone}>{c.priority >= 10 ? 'Urgent · ' : ''}{r.label}</Pill>
                      <span className="text-muted-foreground text-[11px]">due {relativeTime(c.dueAt, now)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : <Empty icon={Sparkles} title="No calls waiting" hint="When someone needs a call, they will appear here." />}
        </Panel>

        <Panel title="Site visits today" description="Buyers coming to see the plots." href="/app/visits"
          linkLabel="All visits" icon={CalendarCheck}>
          {visitsToday.length ? (
            <ul className="divide-y">
              {visitsToday.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-3 py-3">
                  <LeadIdentity id={v.leadId} name={v.name} phone={v.phone} />
                  <span className="bg-gold-soft rounded-lg px-2.5 py-1 text-sm font-medium text-amber-900">
                    {describeVisit(v.visitAt).split(' at ')[1]}
                  </span>
                </li>
              ))}
            </ul>
          ) : <Empty icon={CalendarCheck} title="No visits today" hint="Visits Meera books on WhatsApp appear here." />}
        </Panel>

        <Panel title="Hot buyers" description="Ready to buy soon — each has an agent." href="/app/leads?category=HOT"
          linkLabel="All hot buyers" icon={Flame}>
          {hot.length ? (
            <ul className="divide-y">
              {hot.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 py-3">
                  <LeadIdentity id={h.id} name={h.name} phone={h.phone} sub={h.summary ?? undefined} />
                  <span className="text-muted-foreground shrink-0 text-xs">{h.owner ?? 'No agent yet'}</span>
                </li>
              ))}
            </ul>
          ) : <Empty icon={Flame} title="No hot buyers right now" hint="A buyer becomes hot when he is ready to buy soon." />}
        </Panel>

        <Panel title="New leads today" description="Every one got a WhatsApp within a minute." href="/app/leads"
          linkLabel="All leads" icon={UserPlus}>
          {newToday.length ? (
            <ul className="divide-y">
              {newToday.map((n) => (
                <li key={n.id} className="flex items-center justify-between gap-3 py-3">
                  <LeadIdentity id={n.id} name={n.name} phone={n.phone} />
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {sourceName(n.source)} · {relativeTime(n.createdAt, now)}
                  </span>
                </li>
              ))}
            </ul>
          ) : <Empty icon={UserPlus} title="No new leads yet today" hint="Leads from 99acres, MagicBricks and others land here." />}
        </Panel>
      </div>
    </div>
  );
}

function Callout({ tone, icon: Icon, href, action, children }: {
  tone: 'hot' | 'gold' | 'bad'; icon: typeof Flame; href?: string; action?: string; children: React.ReactNode;
}) {
  const colours = {
    hot: 'border-rose-200 bg-rose-50 text-rose-900',
    gold: 'border-amber-200 bg-amber-50 text-amber-900',
    bad: 'border-red-200 bg-red-50 text-red-900',
  }[tone];
  return (
    <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm ${colours}`}>
      <Icon className="size-4 shrink-0" />
      <p className="flex-1">{children}</p>
      {href && action && (
        <Link href={href} className="shrink-0 rounded-md bg-white/70 px-3 py-1 text-xs font-medium hover:bg-white">
          {action}
        </Link>
      )}
    </div>
  );
}
