import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import {
  ArrowRight, BadgeCheck, CalendarCheck, CheckCheck, Eye, Flame, Globe, Loader2, MapPin,
  MessageCircle, PhoneCall, RotateCcw, Sparkles, UserCheck, XCircle,
} from 'lucide-react';
import { requireUser } from '@/lib/auth/require';
import { db } from '@/lib/db';
import { agents, callTasks, leads, messages, touches, visits } from '@/lib/db/schema';
import { getProjectData } from '@/lib/project-data';
import { formatIST } from '@/lib/format';
import { formatPhone } from '@/lib/phone';
import { callReason, category } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/app/page-header';
import { Pill } from '@/components/app/pill';
import { LiveBadge, LiveRefresh } from '@/components/app/live-refresh';
import { Elapsed } from '@/components/app/elapsed';
import { EnquiryForm } from './enquiry-form';

/** Room for the opening WhatsApp, sent just after the enquiry is saved. */
export const maxDuration = 60;
export const dynamic = 'force-dynamic';
export const metadata = { title: '99acres enquiry · Landmark Lead Desk' };

const gap = (from: Date, to: Date) => {
  const s = Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
  return s < 60 ? `${s} sec` : `${Math.floor(s / 60)} min ${s % 60} sec`;
};
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

export default async function PortalDemoPage({ searchParams }: PageProps<'/app/demo/99acres'>) {
  await requireUser('/app/demo/99acres');
  const { lead: leadParam } = await searchParams;
  const leadId = typeof leadParam === 'string' && /^[0-9a-f-]{36}$/.test(leadParam) ? leadParam : null;
  const project = await getProjectData();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Live demo"
        title="A buyer enquires on 99acres"
        description="Fill this in exactly as a buyer would on 99acres. Once 99acres is connected, every real enquiry arrives here on its own, day or night — and Meera messages the buyer on WhatsApp within seconds."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* The portal side — what the buyer sees. */}
        <section className="bg-card overflow-hidden rounded-2xl border shadow-[0_1px_2px_rgba(16,40,30,0.04)]">
          <div className="bg-muted/60 flex items-center gap-2 border-b px-4 py-2.5 text-xs">
            <Globe className="text-muted-foreground size-3.5" />
            <span className="text-muted-foreground">99acres.com · property listing</span>
            <span className="ml-auto rounded-full border px-2 py-0.5 text-[10px] tracking-wide uppercase">Stand-in until connected</span>
          </div>
          <div className="relative flex h-36 items-end bg-[linear-gradient(135deg,oklch(0.42_0.07_162),oklch(0.30_0.05_165))] p-5 text-white">
            <div className="absolute top-4 right-4 inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[11px] backdrop-blur">
              <BadgeCheck className="size-3.5" /> RERA {project.approvals.rera ? 'registered' : 'applied'}
            </div>
            <div>
              <p className="font-display text-2xl leading-tight">{project.name}</p>
              <p className="inline-flex items-center gap-1 text-sm text-white/80"><MapPin className="size-3.5" /> {project.location}</p>
            </div>
          </div>
          <div className="space-y-5 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p><span className="text-muted-foreground text-xs">Plots from</span>{' '}
                <span className="text-xl font-semibold">{project.entry_price}</span></p>
              <p className="text-muted-foreground text-xs">by {project.developer}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {project.plots.map((p) => (
                <span key={p.size} className="bg-secondary rounded-md px-2 py-1 text-xs">{p.size} · {p.sqft} sq ft</span>
              ))}
            </div>
            <div className="border-t pt-5">
              <p className="mb-3 text-sm font-semibold">Contact the builder</p>
              <EnquiryForm key={leadId ?? 'new'} />
            </div>
          </div>
        </section>

        {/* Our side — what happens next, live. */}
        {leadId ? <Tracker leadId={leadId} /> : <WhatHappens />}
      </div>
    </div>
  );
}

/** Before an enquiry: what is about to happen, so the room knows what to watch. */
function WhatHappens() {
  const steps = [
    { icon: Globe, t: 'Enquiry arrives from 99acres', d: 'Instantly — no one has to copy it from an email.' },
    { icon: MessageCircle, t: 'Meera sends a WhatsApp', d: 'Within seconds, at any hour — even 2 AM on a Sunday.' },
    { icon: CheckCheck, t: 'We see it delivered and read', d: 'Not on WhatsApp? The buyer goes straight to the call list.' },
    { icon: Sparkles, t: 'Meera answers every question', d: 'Prices, plot sizes, approvals, location — in the buyer’s language.' },
    { icon: Flame, t: 'Meera judges how serious they are', d: 'Hot, warm or cold — from budget, timing and interest.' },
    { icon: PhoneCall, t: 'Hot buyers go to a sales agent', d: 'With a summary, so the call starts where the chat left off.' },
    { icon: CalendarCheck, t: 'Site visit booked and reminded', d: 'Reminders go out by themselves. No-shows are followed up.' },
  ];
  return (
    <section className="bg-card rounded-2xl border p-6 shadow-[0_1px_2px_rgba(16,40,30,0.04)]">
      <p className="text-sm font-semibold">What happens the moment they press “Contact builder”</p>
      <p className="text-muted-foreground mb-5 text-xs">This panel turns live and ticks off each step as it really happens.</p>
      <ol className="space-y-4">
        {steps.map(({ icon: Icon, t, d }, i) => (
          <li key={t} className="flex gap-3">
            <span className="bg-secondary text-primary inline-flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
              <Icon className="size-4" />
            </span>
            <div>
              <p className="text-sm font-medium"><span className="text-muted-foreground mr-1">{i + 1}.</span>{t}</p>
              <p className="text-muted-foreground text-xs">{d}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

type Step = { icon: typeof Globe; title: string; detail?: React.ReactNode; at?: Date | null; state: 'done' | 'bad' | 'todo' };

async function Tracker({ leadId }: { leadId: string }) {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) {
    return (
      <section className="bg-card rounded-2xl border p-6 text-sm">
        This enquiry is no longer here. <Link href="/app/demo/99acres" className="text-primary underline">Start a new one</Link>.
      </section>
    );
  }

  const [msgs, events, calls, booked] = await Promise.all([
    db.select().from(messages).where(eq(messages.leadId, leadId)).orderBy(asc(messages.sentAt)),
    db.select().from(touches).where(eq(touches.leadId, leadId)).orderBy(asc(touches.happenedAt)),
    db.select({ reason: callTasks.reason, agent: agents.name, createdAt: callTasks.createdAt })
      .from(callTasks).leftJoin(agents, eq(agents.id, callTasks.agentId))
      .where(eq(callTasks.leadId, leadId)).orderBy(asc(callTasks.createdAt)),
    db.select().from(visits).where(eq(visits.leadId, leadId)).orderBy(asc(visits.createdAt)),
  ]);

  const outs = msgs.filter((m) => m.direction === 'outbound');
  const ins = msgs.filter((m) => m.direction === 'inbound');
  const firstOut = outs[0];
  const firstIn = ins[0];
  const answer = firstIn ? outs.find((m) => m.sentAt > firstIn.sentAt && !m.templateName) : undefined;
  const ws = lead.waState;
  const deliveredAt = events.find((e) => e.outcome === 'delivered' || e.outcome === 'read')?.happenedAt;
  const readAt = events.find((e) => e.outcome === 'read')?.happenedAt;
  const delivered = Boolean(deliveredAt) || ws === 'DELIVERED' || ws === 'READ' || ws === 'REPLIED';
  const read = Boolean(readAt) || ws === 'READ' || ws === 'REPLIED';
  const notOnWa = ws === 'NOT_ON_WHATSAPP';
  const cat = lead.category ? category(lead.category) : null;
  const call = calls[0];
  const visit = booked.find((v) => v.status !== 'CANCELLED');

  const steps: Step[] = [
    { icon: Globe, title: 'Enquiry arrived from 99acres', at: lead.createdAt, state: 'done',
      detail: `${lead.name?.trim() || 'Buyer'} · ${formatPhone(lead.phone)}` },
    firstOut
      ? { icon: MessageCircle, title: 'Meera sent a WhatsApp', at: firstOut.sentAt, state: 'done',
          detail: <>in <b>{gap(lead.createdAt, firstOut.sentAt)}</b> after the enquiry</> }
      : { icon: MessageCircle, title: 'Meera is sending a WhatsApp…', state: 'todo' },
    notOnWa
      ? { icon: XCircle, title: 'Not on WhatsApp — moved to the call list', state: 'bad',
          detail: 'Nobody is lost: an agent is asked to phone them instead.' }
      : { icon: CheckCheck, title: 'Delivered to their phone', at: deliveredAt, state: delivered ? 'done' : 'todo' },
    ...(notOnWa ? [] : [{ icon: Eye, title: 'They opened it', at: readAt, state: read ? 'done' : 'todo' } as Step]),
    firstIn
      ? { icon: MessageCircle, title: 'They replied', at: firstIn.sentAt, state: 'done', detail: `“${clip(firstIn.body, 90)}”` }
      : { icon: MessageCircle, title: 'Waiting for them to reply', state: 'todo', detail: 'Reply from the phone and watch this update.' },
    answer
      ? { icon: Sparkles, title: 'Meera answered', at: answer.sentAt, state: 'done',
          detail: <>in <b>{gap(firstIn!.sentAt, answer.sentAt)}</b> — “{clip(answer.body, 110)}”</> }
      : { icon: Sparkles, title: 'Meera answers', state: 'todo' },
    cat
      ? { icon: Flame, title: 'Meera judged how serious they are', state: 'done',
          detail: <span className="inline-flex flex-wrap items-center gap-2"><Pill tone={cat.tone} dot>{cat.label}</Pill>{cat.hint}</span> }
      : { icon: Flame, title: 'Meera judges how serious they are', state: 'todo', detail: 'After a few messages about budget, timing and plot size.' },
    call
      ? { icon: PhoneCall, title: `${call.agent ?? 'The sales team'} was asked to call`, at: call.createdAt, state: 'done',
          detail: <Link href="/app/calls" className="text-primary hover:underline">{callReason(call.reason).label} — see the call list</Link> }
      : { icon: UserCheck, title: 'Hot buyers are handed to a sales agent', state: 'todo' },
    visit
      ? { icon: CalendarCheck, title: 'Site visit booked', state: 'done', detail: `${formatIST(visit.visitAt, 'EEEE d MMM, h:mm a')} — reminders go out automatically` }
      : { icon: CalendarCheck, title: 'Site visit booked', state: 'todo' },
  ];
  const current = steps.findIndex((s) => s.state === 'todo');

  return (
    <section className="space-y-4">
      <LiveRefresh every={2000} />

      {/* The headline number — speed to lead. */}
      <div className="bg-sidebar text-sidebar-foreground relative overflow-hidden rounded-2xl p-6">
        <div className="pointer-events-none absolute -top-24 -right-24 size-64 rounded-full bg-[radial-gradient(circle,var(--gold)_0%,transparent_70%)] opacity-20" />
        <div className="flex items-center justify-between">
          <p className="text-sidebar-foreground/70 text-xs tracking-wider uppercase">Time to first WhatsApp</p>
          <LiveBadge />
        </div>
        <p className="font-display mt-2 text-5xl">
          {firstOut ? gap(lead.createdAt, firstOut.sentAt) : <Elapsed from={lead.createdAt.toISOString()} />}
        </p>
        <p className="text-sidebar-foreground/70 mt-1 text-sm">
          {firstOut ? 'From the enquiry to a WhatsApp on the buyer’s phone — no human involved.' : 'Meera is writing to the buyer now…'}
        </p>
      </div>

      <div className="bg-card rounded-2xl border p-5 shadow-[0_1px_2px_rgba(16,40,30,0.04)]">
        <ol className="relative space-y-4">
          {steps.map((s, i) => {
            const Icon = s.state === 'todo' && i === current ? Loader2 : s.icon;
            return (
              <li key={i} className={cn('flex gap-3', s.state === 'todo' && i !== current && 'opacity-45')}>
                <span className={cn('inline-flex size-8 shrink-0 items-center justify-center rounded-full',
                  s.state === 'done' && 'bg-emerald-100 text-emerald-700',
                  s.state === 'bad' && 'bg-rose-100 text-rose-700',
                  s.state === 'todo' && (i === current ? 'bg-amber-100 text-amber-800' : 'bg-secondary text-muted-foreground'))}>
                  <Icon className={cn('size-4', s.state === 'todo' && i === current && 'animate-spin')} />
                </span>
                <div className="min-w-0 flex-1 pt-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className="text-sm font-medium">{s.title}</p>
                    {s.at && <p className="text-muted-foreground text-xs tabular-nums">{formatIST(s.at, 'h:mm:ss a')}</p>}
                  </div>
                  {s.detail && <div className="text-muted-foreground mt-0.5 text-xs">{s.detail}</div>}
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href={`/app/leads/${lead.id}`}
          className="bg-primary text-primary-foreground inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium">
          Open the full conversation <ArrowRight className="size-4" />
        </Link>
        <Link href="/app/demo/99acres" className="bg-card inline-flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm">
          <RotateCcw className="size-4" /> Another enquiry
        </Link>
      </div>
    </section>
  );
}
