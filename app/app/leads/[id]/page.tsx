import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asc, desc, eq } from 'drizzle-orm';
import {
  ArrowLeft, CalendarCheck, FileText, MessageCircle, Phone, PhoneCall, Repeat, Sparkles, UserRound,
} from 'lucide-react';
import { requireUser } from '@/lib/auth/require';
import { db } from '@/lib/db';
import {
  agents, callTasks, chaseStates, CHASE_STATES, leads, messages, touches, visits, type ChaseState,
} from '@/lib/db/schema';
import { formatPhone } from '@/lib/phone';
import { formatIST } from '@/lib/format';
import { describeVisit } from '@/lib/visit-time';
import { CHASE_LABELS, CHASE_STEPS } from '@/lib/chase';
import { markVisit, nextFollowUpStep, startFollowUp, stopFollowUp } from '@/lib/actions/chase';
import {
  CALL_OUTCOME, LANGUAGE, PURPOSE, TIMELINE, VISIT_STATUS, callReason, category, leadStatus,
  relativeTime, sourceName,
} from '@/lib/labels';
import { Avatar } from '@/components/app/lead-identity';
import { Pill } from '@/components/app/pill';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: PageProps<'/app/leads/[id]'>) {
  const { id } = await props.params;
  const [lead] = await db.select({ name: leads.name, phone: leads.phone }).from(leads).where(eq(leads.id, id)).limit(1);
  return { title: `${lead?.name?.trim() || (lead ? formatPhone(lead.phone) : 'Lead')} · Landmark Lead Desk` };
}
/** Room for the follow-up a button here starts, which runs just after. */
export const maxDuration = 60;

export default async function LeadPage(props: PageProps<'/app/leads/[id]'>) {
  const session = await requireUser('/app/leads');
  const isAdmin = session.role === 'admin';
  const { id } = await props.params;

  const [lead] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  if (!lead) notFound();

  const [owner] = lead.ownerAgentId
    ? await db.select().from(agents).where(eq(agents.id, lead.ownerAgentId)).limit(1)
    : [];

  const [chat, calls, booked, allTouches, chases] = await Promise.all([
    db.select().from(messages).where(eq(messages.leadId, id)).orderBy(asc(messages.sentAt)),
    db.select().from(callTasks).where(eq(callTasks.leadId, id)).orderBy(desc(callTasks.dueAt)),
    db.select().from(visits).where(eq(visits.leadId, id)).orderBy(desc(visits.visitAt)),
    db.select().from(touches).where(eq(touches.leadId, id)).orderBy(asc(touches.happenedAt)),
    db.select().from(chaseStates).where(eq(chaseStates.leadId, id)).orderBy(desc(chaseStates.createdAt)).limit(5),
  ]);

  const now = new Date();
  const pendingCall = calls.find((c) => c.status === 'PENDING');
  const activeChase = chases.find((c) => c.status === 'ACTIVE');
  const lastEnded = chases.find((c) => c.status !== 'ACTIVE');
  const nextVisit = booked.find((v) => v.status === 'BOOKED');
  const pastVisits = booked.filter((v) => v.status !== 'BOOKED');
  const callsMade = allTouches.filter((t) => t.channel === 'call');
  const cat = category(lead.category);
  const st = leadStatus(lead.status);
  const name = lead.name?.trim() || 'Name not shared yet';

  // One story, in the order it happened: what was said, and what was done.
  type Entry = { at: Date; kind: 'buyer' | 'us' | 'template' | 'document' | 'event'; text: string };
  const story: Entry[] = [
    ...chat.map((m): Entry => {
      const body = m.body ?? '';
      if (m.direction === 'inbound') return { at: m.sentAt, kind: 'buyer', text: body };
      const doc = /^\[document: (.+)\]$/.exec(body);
      if (doc) return { at: m.sentAt, kind: 'document', text: doc[1] };
      if (m.templateName || body.startsWith('[template:')) return { at: m.sentAt, kind: 'template', text: 'Opening WhatsApp sent (approved template)' };
      return { at: m.sentAt, kind: 'us', text: body };
    }),
    ...allTouches.filter((t) => t.channel === 'call').map((t): Entry => ({
      at: t.happenedAt, kind: 'event',
      text: `Phone call — ${CALL_OUTCOME[t.outcome ?? ''] ?? t.outcome ?? 'made'}${t.notes ? ` · ${t.notes}` : ''}`,
    })),
    ...allTouches.filter((t) => t.channel === 'portal').map((t): Entry => ({
      at: t.happenedAt, kind: 'event', text: `Enquiry received from ${sourceName(lead.source)}`,
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime()
    // Same moment: the enquiry came first, then our opening message.
    || Number(b.text.startsWith('Enquiry received')) - Number(a.text.startsWith('Enquiry received')));

  // What happens next — the one question an agent opens this page to answer.
  let next: { icon: typeof Phone; title: string; detail: string } = {
    icon: Sparkles, title: 'Nothing scheduled', detail: 'Meera is handling the WhatsApp chat. A follow-up starts by itself if this buyer goes quiet.',
  };
  if (['WON'].includes(lead.status)) next = { icon: Sparkles, title: 'Bought a plot', detail: 'Nothing more to do.' };
  else if (['LOST', 'REJECTED'].includes(lead.status)) next = { icon: UserRound, title: st.label, detail: 'Will not be contacted again.' };
  else if (pendingCall) next = { icon: PhoneCall, title: `Call ${pendingCall.dueAt <= now ? 'now' : relativeTime(pendingCall.dueAt, now)}`, detail: callReason(pendingCall.reason).label };
  else if (nextVisit) next = { icon: CalendarCheck, title: `Site visit ${relativeTime(nextVisit.visitAt, now)}`, detail: describeVisit(nextVisit.visitAt) };
  else if (activeChase?.nextStepAt) next = { icon: Repeat, title: `Automatic follow-up ${relativeTime(activeChase.nextStepAt, now)}`, detail: `${CHASE_LABELS[activeChase.state as ChaseState] ?? activeChase.state} — no need to do anything` };

  const facts: [string, string | null | undefined][] = [
    ['Budget', lead.budget],
    ['When buying', lead.timeline ? TIMELINE[lead.timeline] ?? lead.timeline : null],
    ['Buying for', lead.purpose ? PURPOSE[lead.purpose] ?? lead.purpose : null],
    ['Plot size wanted', lead.interestedPlot],
    ['Speaks', lead.language ? LANGUAGE[lead.language] ?? lead.language : null],
    ['Came from', sourceName(lead.source)],
    ['Sales agent', owner?.name],
    ['Phone calls made', callsMade.length ? String(callsMade.length) : null],
  ];

  return (
    <div className="space-y-6">
      <Link href="/app/leads" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm">
        <ArrowLeft className="size-4" /> All leads
      </Link>

      {/* Who */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar name={lead.name} seed={lead.phone} size="lg" />
          <div className="space-y-1">
            <h1 className={`text-3xl font-semibold ${lead.name?.trim() ? '' : 'text-muted-foreground italic'}`}>{name}</h1>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">{formatPhone(lead.phone)}</span>
              <Pill tone={cat.tone} dot title={cat.hint}>{cat.label}{lead.category && lead.score ? ` · ${lead.score} pts` : ''}</Pill>
              <Pill tone={st.tone} title={st.hint}>{st.label}</Pill>
              {lead.optedOut && <Pill tone="bad">Asked not to be messaged</Pill>}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button asChild><a href={`tel:+${lead.phone}`}><Phone className="size-4" /> Call</a></Button>
          <Button asChild variant="outline"><a href={`https://wa.me/${lead.phone}`} target="_blank" rel="noreferrer"><MessageCircle className="size-4" /> WhatsApp</a></Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <div className="space-y-6">
          {/* Next */}
          <section className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-5">
            <p className="text-xs font-medium tracking-wider text-amber-800 uppercase">What happens next</p>
            <div className="mt-2 flex items-start gap-3">
              <span className="bg-gold/20 inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-amber-900">
                <next.icon className="size-[18px]" />
              </span>
              <div>
                <p className="font-semibold">{next.title}</p>
                <p className="text-muted-foreground text-sm">{next.detail}</p>
              </div>
            </div>
          </section>

          {/* About */}
          <section className="bg-card rounded-2xl border p-5">
            <h2 className="mb-3 text-[15px] font-semibold">About this buyer</h2>
            {lead.summary && (
              <p className="bg-muted/70 mb-4 rounded-xl px-4 py-3 text-sm leading-relaxed">“{lead.summary}”</p>
            )}
            <dl className="divide-y text-sm">
              {facts.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 py-2">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className={v ? 'text-right font-medium' : 'text-muted-foreground/60 text-right'}>{v || 'Not known yet'}</dd>
                </div>
              ))}
            </dl>
            <p className="text-muted-foreground mt-3 text-xs">
              Filled in automatically from the WhatsApp chat. Arrived {relativeTime(lead.createdAt, now)}.
            </p>
          </section>

          {/* Visit */}
          {(nextVisit || pastVisits.length > 0) && (
            <section className="bg-card space-y-3 rounded-2xl border p-5">
              <h2 className="text-[15px] font-semibold">Site visit</h2>
              {nextVisit && (
                <div className="space-y-3">
                  <p className="text-sm">
                    <span className="font-medium">{describeVisit(nextVisit.visitAt)}</span>
                    <span className="text-muted-foreground block text-xs">
                      {nextVisit.remindedAt ? `Reminder sent ${relativeTime(nextVisit.remindedAt, now)}` : 'A reminder goes the day before'}
                    </span>
                  </p>
                  {nextVisit.visitAt <= now && (
                    <form action={markVisit} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="visitId" value={nextVisit.id} />
                      <span className="text-sm">Did they come?</span>
                      <Button type="submit" name="outcome" value="ATTENDED" size="sm">Yes, they came</Button>
                      <Button type="submit" name="outcome" value="NO_SHOW" size="sm" variant="outline">No</Button>
                    </form>
                  )}
                </div>
              )}
              {pastVisits.map((v) => {
                const vs = VISIT_STATUS[v.status] ?? { label: v.status, tone: 'neutral' as const };
                return (
                  <p key={v.id} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{describeVisit(v.visitAt)}</span>
                    <Pill tone={vs.tone}>{vs.label}</Pill>
                  </p>
                );
              })}
            </section>
          )}

          {/* Follow-up */}
          <section className="bg-card space-y-3 rounded-2xl border p-5">
            <h2 className="text-[15px] font-semibold">Automatic follow-up</h2>
            {activeChase ? (
              <>
                <p className="text-sm">
                  <Pill tone="gold">{CHASE_LABELS[activeChase.state as ChaseState] ?? activeChase.state}</Pill>{' '}
                  {activeChase.step < CHASE_STEPS[activeChase.state as ChaseState].length
                    ? <>Step {activeChase.step + 1} of {CHASE_STEPS[activeChase.state as ChaseState].length}</>
                    : <>All steps done — waiting for a reply</>}
                </p>
                {activeChase.nextStepAt && (
                  <p className="text-muted-foreground text-xs">Next step {relativeTime(activeChase.nextStepAt, now)} · {formatIST(activeChase.nextStepAt)}</p>
                )}
                <p className="text-muted-foreground text-xs">Stops by itself the moment the buyer replies or picks up.</p>
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
              <p className="text-muted-foreground text-sm">None running. One starts by itself if this buyer goes quiet.</p>
            )}
            {lastEnded && (
              <p className="text-muted-foreground border-t pt-3 text-xs">
                Last: {CHASE_LABELS[lastEnded.state as ChaseState] ?? lastEnded.state} — {lastEnded.status === 'CANCELLED' ? 'stopped' : 'finished'}
                {lastEnded.endedReason && <> ({lastEnded.endedReason})</>}
                {lastEnded.endedAt && <>, {relativeTime(lastEnded.endedAt, now)}</>}
              </p>
            )}
            {isAdmin && (
              <form action={startFollowUp} className="flex flex-wrap items-center gap-2 border-t pt-3">
                <input type="hidden" name="leadId" value={lead.id} />
                <select name="state" aria-label="Which follow-up" className="border-input bg-card h-8 rounded-md border px-2 text-xs">
                  {CHASE_STATES.map((s) => <option key={s} value={s}>{CHASE_LABELS[s]}</option>)}
                </select>
                <Button type="submit" size="sm" variant="outline">{activeChase ? 'Switch to this' : 'Start this follow-up'}</Button>
              </form>
            )}
          </section>
        </div>

        {/* The conversation */}
        <section className="bg-card flex flex-col rounded-2xl border">
          <header className="flex items-center justify-between border-b px-5 py-4">
            <div>
              <h2 className="text-[15px] font-semibold">Conversation</h2>
              <p className="text-muted-foreground text-xs">Everything said on WhatsApp, and every call — in order.</p>
            </div>
            <span className="text-muted-foreground text-xs">{chat.length} message{chat.length === 1 ? '' : 's'}</span>
          </header>
          <div className="flex-1 space-y-3 bg-[oklch(0.975_0.008_85)] px-4 py-5">
            {story.length === 0 && <p className="text-muted-foreground py-10 text-center text-sm">Nothing yet.</p>}
            {story.map((e, i) => {
              const day = formatIST(e.at, 'EEEE d MMMM');
              const newDay = i === 0 || formatIST(story[i - 1].at, 'EEEE d MMMM') !== day;
              return (
                <div key={i}>
                  {newDay && (
                    <p className="my-2 text-center"><span className="bg-card text-muted-foreground rounded-full border px-3 py-0.5 text-[11px]">{day}</span></p>
                  )}
                  {e.kind === 'buyer' && (
                    <div className="flex">
                      <div className="bg-card max-w-[80%] rounded-2xl rounded-tl-sm border px-3.5 py-2 text-sm shadow-sm">
                        <p className="whitespace-pre-wrap">{e.text}</p>
                        <p className="text-muted-foreground mt-1 text-right text-[10px]">{formatIST(e.at, 'h:mm a')}</p>
                      </div>
                    </div>
                  )}
                  {e.kind === 'us' && (
                    <div className="flex justify-end">
                      <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-[#dcf3e3] px-3.5 py-2 text-sm shadow-sm">
                        <p className="mb-0.5 text-[10px] font-medium text-emerald-800">Meera</p>
                        <p className="whitespace-pre-wrap">{e.text}</p>
                        <p className="text-muted-foreground mt-1 text-right text-[10px]">{formatIST(e.at, 'h:mm a')}</p>
                      </div>
                    </div>
                  )}
                  {e.kind === 'document' && (
                    <div className="flex justify-end">
                      <div className="flex items-center gap-2 rounded-xl bg-[#dcf3e3] px-3 py-2 text-sm shadow-sm">
                        <FileText className="size-4 text-emerald-800" /> {e.text}
                      </div>
                    </div>
                  )}
                  {(e.kind === 'event' || e.kind === 'template') && (
                    <p className="text-center">
                      <span className="text-muted-foreground inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1 text-xs">
                        {e.kind === 'event' ? <Phone className="size-3" /> : <MessageCircle className="size-3" />} {e.text} · {formatIST(e.at, 'h:mm a')}
                      </span>
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
