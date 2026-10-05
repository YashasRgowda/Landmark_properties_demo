import { and, asc, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import { BellRing, CalendarCheck, CalendarClock, History, HelpCircle } from 'lucide-react';
import { requireUser } from '@/lib/auth/require';
import { db } from '@/lib/db';
import { agents, leads, visits } from '@/lib/db/schema';
import { markVisit } from '@/lib/actions/chase';
import { fromIst, istParts } from '@/lib/visit-time';
import { formatIST } from '@/lib/format';
import { VISIT_STATUS, relativeTime } from '@/lib/labels';
import { PageHeader } from '@/components/app/page-header';
import { LeadIdentity } from '@/components/app/lead-identity';
import { Pill } from '@/components/app/pill';
import { Empty, Panel } from '@/components/app/panel';
import { Button } from '@/components/ui/button';

export const metadata = { title: 'Site visits · Landmark Lead Desk' };
export const dynamic = 'force-dynamic';
/** Room for the follow-up a "No, they didn't come" starts, which runs just after. */
export const maxDuration = 60;

const DAY = 24 * 60 * 60_000;

export default async function VisitsPage() {
  await requireUser('/app/visits');

  const now = new Date();
  const today = istParts(now);
  const startOfToday = fromIst(today.year, today.month, today.day, 0, 0);
  const startOfTomorrow = new Date(startOfToday.getTime() + DAY);

  const cols = {
    id: visits.id, visitAt: visits.visitAt, label: visits.label, status: visits.status,
    remindedAt: visits.remindedAt, leadId: leads.id, name: leads.name, phone: leads.phone, owner: agents.name,
  };
  const base = () => db.select(cols).from(visits)
    .innerJoin(leads, eq(leads.id, visits.leadId)).leftJoin(agents, eq(agents.id, leads.ownerAgentId));

  const [needsOutcome, upcoming, recent] = await Promise.all([
    base().where(and(eq(visits.status, 'BOOKED'), lt(visits.visitAt, now))).orderBy(asc(visits.visitAt)),
    base().where(and(eq(visits.status, 'BOOKED'), gte(visits.visitAt, now), lt(visits.visitAt, new Date(now.getTime() + 60 * DAY))))
      .orderBy(asc(visits.visitAt)),
    base().where(and(inArray(visits.status, ['ATTENDED', 'NO_SHOW']), gte(visits.visitAt, new Date(now.getTime() - 14 * DAY))))
      .orderBy(desc(visits.visitAt)),
  ]);
  const todays = upcoming.filter((v) => v.visitAt < startOfTomorrow);
  const later = upcoming.filter((v) => v.visitAt >= startOfTomorrow);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Site visits"
        description="Buyers coming to see the plots. Each gets a WhatsApp reminder the day before, with the map and pickup offer."
      />

      {needsOutcome.length > 0 && (
        <Panel title="Did they come?" icon={HelpCircle} tone="urgent"
          description="These visits have passed. Tap one answer each — a buyer who didn't come gets a kind message today.">
          <ul className="divide-y">{needsOutcome.map((v) => <VisitRow key={v.id} v={v} now={now} ask />)}</ul>
        </Panel>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Today" icon={CalendarCheck} description="Coming to the site today.">
          {todays.length ? <ul className="divide-y">{todays.map((v) => <VisitRow key={v.id} v={v} now={now} />)}</ul>
            : <Empty icon={CalendarCheck} title="No visits today" />}
        </Panel>
        <Panel title="Coming up" icon={CalendarClock} description="Booked for the days ahead.">
          {later.length ? <ul className="divide-y">{later.map((v) => <VisitRow key={v.id} v={v} now={now} />)}</ul>
            : <Empty icon={CalendarClock} title="Nothing booked yet" hint="Meera books visits on WhatsApp when a buyer agrees a day and time." />}
        </Panel>
      </div>

      {recent.length > 0 && (
        <Panel title="Last two weeks" icon={History} description="Who came, and who didn't.">
          <ul className="divide-y">{recent.map((v) => <VisitRow key={v.id} v={v} now={now} />)}</ul>
        </Panel>
      )}
    </div>
  );
}

type Row = {
  id: string; visitAt: Date; label: string | null; status: string; remindedAt: Date | null;
  leadId: string; name: string | null; phone: string; owner: string | null;
};

function VisitRow({ v, now, ask }: { v: Row; now: Date; ask?: boolean }) {
  const outcome = VISIT_STATUS[v.status];
  return (
    <li className="flex flex-wrap items-center gap-4 py-3.5">
      <div className="bg-gold-soft flex w-16 shrink-0 flex-col items-center rounded-xl py-1.5 text-amber-900">
        <span className="text-[10px] font-medium uppercase">{formatIST(v.visitAt, 'EEE')}</span>
        <span className="text-lg leading-tight font-semibold">{formatIST(v.visitAt, 'd')}</span>
        <span className="text-[11px]">{formatIST(v.visitAt, 'h:mm a')}</span>
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <LeadIdentity id={v.leadId} name={v.name} phone={v.phone} size="sm" />
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-3 text-xs">
          <span>{relativeTime(v.visitAt, now)}</span>
          {v.owner && <span>Agent: {v.owner}</span>}
          {v.status === 'BOOKED' && (
            <span className="inline-flex items-center gap-1">
              <BellRing className="size-3" />{v.remindedAt ? 'Reminder sent' : 'Reminder goes the day before'}
            </span>
          )}
        </p>
      </div>
      {ask && v.status === 'BOOKED' ? (
        <form action={markVisit} className="flex gap-2">
          <input type="hidden" name="visitId" value={v.id} />
          <Button type="submit" name="outcome" value="ATTENDED" size="sm">Yes, they came</Button>
          <Button type="submit" name="outcome" value="NO_SHOW" size="sm" variant="outline">No</Button>
        </form>
      ) : outcome && v.status !== 'BOOKED' ? <Pill tone={outcome.tone}>{outcome.label}</Pill> : null}
    </li>
  );
}
