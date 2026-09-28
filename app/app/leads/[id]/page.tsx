import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asc, desc, eq } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/require';
import { db } from '@/lib/db';
import { agents, callTasks, chaseStates, CHASE_STATES, leads, messages, touches, visits, type ChaseState } from '@/lib/db/schema';
import { CHASE_LABELS, CHASE_STEPS } from '@/lib/chase';
import { markVisit, nextFollowUpStep, startFollowUp, stopFollowUp } from '@/lib/actions/chase';
import { Button } from '@/components/ui/button';
import { formatPhone } from '@/lib/phone';
import { formatIST } from '@/lib/format';
import { describeVisit } from '@/lib/visit-time';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

export const dynamic = 'force-dynamic';
/** Room for the follow-up a button here starts, which runs just after. */
export const maxDuration = 60;

const CATEGORY_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  HOT: 'default', WARM: 'secondary', COLD: 'outline', REJECT: 'destructive',
};

export default async function LeadPage(props: PageProps<'/app/leads/[id]'>) {
  const session = await requireUser('/app/leads');
  const isAdmin = session.role === 'admin';
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

  const chases = await db
    .select()
    .from(chaseStates)
    .where(eq(chaseStates.leadId, id))
    .orderBy(desc(chaseStates.createdAt))
    .limit(5);
  const activeChase = chases.find((c) => c.status === 'ACTIVE');
  const lastEnded = chases.find((c) => c.status !== 'ACTIVE');
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
              : activeChase?.nextStepAt
                ? <>follow-up {formatIST(activeChase.nextStepAt)}</>
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
            <div className="space-y-2 text-sm">
              <p>
                <strong>Site visit booked:</strong> {describeVisit(nextVisit.visitAt)}
                {nextVisit.label && <span className="text-muted-foreground"> (“{nextVisit.label}”)</span>}
                <span className="text-muted-foreground">
                  {' · '}{nextVisit.remindedAt ? `reminded ${formatIST(nextVisit.remindedAt)}` : 'reminder not sent yet'}
                </span>
              </p>
              <form action={markVisit} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="visitId" value={nextVisit.id} />
                <span className="text-muted-foreground">Did he come?</span>
                <Button type="submit" name="outcome" value="ATTENDED" size="sm" variant="outline">Came</Button>
                <Button type="submit" name="outcome" value="NO_SHOW" size="sm" variant="outline">Didn’t come</Button>
              </form>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Follow-up</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {activeChase ? (
            <>
              <p>
                <Badge>{CHASE_LABELS[activeChase.state as ChaseState] ?? activeChase.state}</Badge>{' '}
                {activeChase.step < CHASE_STEPS[activeChase.state as ChaseState].length
                  ? <>step {activeChase.step + 1} of {CHASE_STEPS[activeChase.state as ChaseState].length}</>
                  : <>every step done — waiting for a reply</>}
                {activeChase.nextStepAt && <> · next {formatIST(activeChase.nextStepAt)}</>}
              </p>
              <p className="text-muted-foreground">Stops by itself the moment he replies or picks up.</p>
              {isAdmin && (
                <div className="flex flex-wrap gap-2">
                  <form action={nextFollowUpStep}>
                    <input type="hidden" name="leadId" value={lead.id} />
                    <Button type="submit" size="sm">Send next step now</Button>
                  </form>
                  <form action={stopFollowUp}>
                    <input type="hidden" name="leadId" value={lead.id} />
                    <Button type="submit" size="sm" variant="outline">Stop</Button>
                  </form>
                </div>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">
              No follow-up running. One starts by itself if he goes quiet.
            </p>
          )}

          {lastEnded && (
            <p className="text-muted-foreground">
              Last: {CHASE_LABELS[lastEnded.state as ChaseState] ?? lastEnded.state} —{' '}
              {lastEnded.status === 'CANCELLED' ? 'stopped' : 'finished'}
              {lastEnded.endedReason && <> ({lastEnded.endedReason})</>}
              {lastEnded.endedAt && <>, {formatIST(lastEnded.endedAt)}</>}
            </p>
          )}

          {isAdmin && (
            <form action={startFollowUp} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="leadId" value={lead.id} />
              <select name="state" className="border-input h-8 rounded-md border bg-transparent px-2 text-sm">
                {CHASE_STATES.map((s) => (
                  <option key={s} value={s}>{CHASE_LABELS[s]}</option>
                ))}
              </select>
              <Button type="submit" size="sm" variant="outline">
                {activeChase ? 'Switch to this follow-up' : 'Start this follow-up'}
              </Button>
            </form>
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
