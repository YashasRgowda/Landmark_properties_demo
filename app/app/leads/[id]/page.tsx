import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asc, desc, eq } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/require';
import { db } from '@/lib/db';
import { agents, callTasks, leads, messages, touches, visits } from '@/lib/db/schema';
import { formatPhone } from '@/lib/phone';
import { formatIST } from '@/lib/format';
import { describeVisit } from '@/lib/visit-time';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

export const dynamic = 'force-dynamic';

const CATEGORY_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  HOT: 'default', WARM: 'secondary', COLD: 'outline', REJECT: 'destructive',
};

export default async function LeadPage(props: PageProps<'/app/leads/[id]'>) {
  await requireUser('/app/leads');
  const { id } = await props.params;

  const [lead] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  if (!lead) notFound();

  const [owner] = lead.ownerAgentId
    ? await db.select().from(agents).where(eq(agents.id, lead.ownerAgentId)).limit(1)
    : [];

  const [chat, calls, booked, allTouches] = await Promise.all([
    db.select().from(messages).where(eq(messages.leadId, id)).orderBy(asc(messages.sentAt)),
    db.select().from(callTasks).where(eq(callTasks.leadId, id)).orderBy(desc(callTasks.dueAt)),
    db.select().from(visits).where(eq(visits.leadId, id)).orderBy(desc(visits.visitAt)),
    db.select().from(touches).where(eq(touches.leadId, id)).orderBy(asc(touches.happenedAt)),
  ]);

  // One merged timeline: what was said and what was done, in the order it
  // happened. Reading two separate lists to work out a buyer's story is how
  // agents miss that he was already rung twice.
  const timeline = [
    ...chat.map((m) => ({
      at: m.sentAt,
      kind: m.direction === 'inbound' ? ('buyer' as const) : ('us' as const),
      text: m.body ?? '',
    })),
    ...allTouches
      .filter((t) => t.channel !== 'whatsapp')
      .map((t) => ({
        at: t.happenedAt,
        kind: 'event' as const,
        text: `${t.channel} · ${t.outcome ?? ''}${t.notes ? ` — ${t.notes}` : ''}`,
      })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  const pendingCall = calls.find((c) => c.status === 'PENDING');
  const nextVisit = booked.find((v) => v.status === 'BOOKED');
  const callsMade = allTouches.filter((t) => t.channel === 'call').length;

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{lead.name?.trim() || formatPhone(lead.phone)}</h1>
          <p className="text-muted-foreground text-sm">
            <a href={`tel:+${lead.phone}`} className="hover:underline">{formatPhone(lead.phone)}</a>
            {lead.language && <> · speaks <span className="capitalize">{lead.language}</span></>}
            {' · from '}{lead.source}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lead.category && (
            <Badge variant={CATEGORY_VARIANT[lead.category] ?? 'outline'}>
              {lead.category} {lead.score != null && `· ${lead.score}`}
            </Badge>
          )}
          <Badge variant="outline">{lead.status}</Badge>
          {lead.optedOut && <Badge variant="destructive">Opted out</Badge>}
        </div>
      </div>

      {/* The track box: everything an agent needs before picking up the phone. */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">The track box</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm">
            Contacted <strong>{allTouches.length}</strong> time{allTouches.length === 1 ? '' : 's'}
            {callsMade > 0 && <> ({callsMade} by phone)</>}
            {' · last '}{formatIST(lead.lastContactAt)}
            {' · next '}
            {pendingCall
              ? <>call {formatIST(pendingCall.dueAt)}</>
              : lead.nextActionAt
                ? <>{lead.nextAction ?? 'action'} {formatIST(lead.nextActionAt)}</>
                : 'nothing scheduled'}
            {' · owner '}{owner?.name ?? 'unassigned'}
          </p>

          <Separator />

          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Fact label="Budget" value={lead.budget} />
            <Fact label="Timeline" value={lead.timeline} />
            <Fact label="Purpose" value={lead.purpose?.replace('_', ' ')} />
            <Fact label="Interested in" value={lead.interestedPlot} />
            <Fact label="WhatsApp" value={lead.waState} />
            <Fact label="Created" value={formatIST(lead.createdAt)} />
          </dl>

          {lead.summary && <p className="bg-muted rounded-md p-3 text-sm">{lead.summary}</p>}

          {nextVisit && (
            <p className="text-sm">
              <strong>Site visit booked:</strong> {describeVisit(nextVisit.visitAt)}
              {nextVisit.label && <span className="text-muted-foreground"> (“{nextVisit.label}”)</span>}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Everything that has happened</CardTitle></CardHeader>
        <CardContent>
          {timeline.length === 0 && (
            <p className="text-muted-foreground text-sm">Nothing yet.</p>
          )}
          <ol className="space-y-3">
            {timeline.map((entry, i) => (
              <li key={i} className="grid grid-cols-[auto_1fr] gap-3 text-sm">
                <span className="text-muted-foreground w-28 shrink-0 tabular-nums">
                  {formatIST(entry.at)}
                </span>
                <span
                  className={
                    entry.kind === 'buyer' ? 'font-medium'
                    : entry.kind === 'event' ? 'text-muted-foreground italic'
                    : ''
                  }
                >
                  {entry.kind === 'buyer' && <span className="text-muted-foreground">Buyer: </span>}
                  {entry.kind === 'us' && <span className="text-muted-foreground">Meera: </span>}
                  {entry.text}
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Link href="/app/leads" className="text-muted-foreground text-sm hover:underline">
        ← All leads
      </Link>
    </main>
  );
}

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-muted-foreground inline font-medium">{label}: </dt>
      <dd className="inline">{value?.trim() || '—'}</dd>
    </div>
  );
}
