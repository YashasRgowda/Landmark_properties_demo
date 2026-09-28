import Link from 'next/link';
import { and, asc, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/require';
import { db } from '@/lib/db';
import { agents, leads, visits } from '@/lib/db/schema';
import { markVisit } from '@/lib/actions/chase';
import { formatPhone } from '@/lib/phone';
import { formatIST } from '@/lib/format';
import { describeVisit, fromIst, istParts } from '@/lib/visit-time';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata = { title: 'Visits · Landmark System 1' };
export const dynamic = 'force-dynamic';
/** Room for the follow-up a "didn't come" starts, which runs just after. */
export const maxDuration = 60;

const DAY = 24 * 60 * 60_000;

export default async function VisitsPage() {
  await requireUser('/app/visits');

  const now = new Date();
  const today = istParts(now);
  const startOfToday = fromIst(today.year, today.month, today.day, 0, 0);
  const startOfTomorrow = new Date(startOfToday.getTime() + DAY);

  const select = {
    id: visits.id,
    visitAt: visits.visitAt,
    label: visits.label,
    status: visits.status,
    remindedAt: visits.remindedAt,
    outcomeAt: visits.outcomeAt,
    leadId: leads.id,
    name: leads.name,
    phone: leads.phone,
    category: leads.category,
    owner: agents.name,
  };
  const base = () => db.select(select).from(visits)
    .innerJoin(leads, eq(leads.id, visits.leadId))
    .leftJoin(agents, eq(agents.id, leads.ownerAgentId));

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
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Visits</h1>
        <p className="text-muted-foreground text-sm">
          {todays.length} today · {later.length} coming up
          {needsOutcome.length > 0 && <> · <strong>{needsOutcome.length} need an outcome</strong></>}
        </p>
      </div>

      {needsOutcome.length > 0 && (
        <Section title="Did he come?" hint="These visits have passed. Mark each one — a no-show gets a message the same day.">
          {needsOutcome.map((v) => <VisitRow key={v.id} v={v} markable />)}
        </Section>
      )}

      <Section title="Today">
        {todays.length ? todays.map((v) => <VisitRow key={v.id} v={v} markable />) : <Empty text="No visits today." />}
      </Section>

      <Section title="Coming up">
        {later.length ? later.map((v) => <VisitRow key={v.id} v={v} />) : <Empty text="Nothing booked yet." />}
      </Section>

      {recent.length > 0 && (
        <Section title="Last two weeks">
          {recent.map((v) => <VisitRow key={v.id} v={v} />)}
        </Section>
      )}
    </div>
  );
}

type Row = {
  id: string; visitAt: Date; label: string | null; status: string; remindedAt: Date | null;
  outcomeAt: Date | null; leadId: string; name: string | null; phone: string;
  category: string | null; owner: string | null;
};

function VisitRow({ v, markable }: { v: Row; markable?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b py-3 text-sm last:border-0">
      <div className="space-y-0.5">
        <p className="font-medium">
          {describeVisit(v.visitAt)}{' '}
          <Link href={`/app/leads/${v.leadId}`} className="hover:underline">
            · {v.name?.trim() || formatPhone(v.phone)}
          </Link>
          {v.category === 'HOT' && <> <Badge>HOT</Badge></>}
        </p>
        <p className="text-muted-foreground">
          <a href={`tel:+${v.phone}`} className="hover:underline">{formatPhone(v.phone)}</a>
          {v.label && <> · “{v.label}”</>}
          {' · '}{v.owner ? `owner ${v.owner}` : 'no owner'}
          {v.status === 'BOOKED' && <> · {v.remindedAt ? `reminded ${formatIST(v.remindedAt)}` : 'not reminded yet'}</>}
        </p>
      </div>
      {v.status === 'ATTENDED' && <Badge variant="secondary">Came</Badge>}
      {v.status === 'NO_SHOW' && <Badge variant="outline">Didn’t come</Badge>}
      {markable && v.status === 'BOOKED' && (
        <form action={markVisit} className="flex gap-2">
          <input type="hidden" name="visitId" value={v.id} />
          <Button type="submit" name="outcome" value="ATTENDED" size="sm" variant="outline">Came</Button>
          <Button type="submit" name="outcome" value="NO_SHOW" size="sm" variant="outline">Didn’t come</Button>
        </form>
      )}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {hint && <p className="text-muted-foreground text-sm">{hint}</p>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-muted-foreground text-sm">{text}</p>;
}
