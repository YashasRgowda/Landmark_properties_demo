import { eq } from 'drizzle-orm';
import { Clock, Phone, PhoneCall, Sparkles } from 'lucide-react';
import { requireUser } from '@/lib/auth/require';
import { db } from '@/lib/db';
import { agents, callTasks, leads, PRIORITY_TOP } from '@/lib/db/schema';
import { formatPhone } from '@/lib/phone';
import { formatIST } from '@/lib/format';
import { callReason, category, relativeTime } from '@/lib/labels';
import { PageHeader } from '@/components/app/page-header';
import { LeadIdentity } from '@/components/app/lead-identity';
import { Pill } from '@/components/app/pill';
import { Empty } from '@/components/app/panel';
import { Button } from '@/components/ui/button';
import { MarkCallForm } from './mark-call-form';
import { LiveRefresh } from '@/components/app/live-refresh';

export const metadata = { title: 'Calls to make · Landmark Lead Desk' };
export const dynamic = 'force-dynamic';

export default async function CallsPage() {
  await requireUser('/app/calls');

  const rows = await db
    .select({
      id: callTasks.id, reason: callTasks.reason, priority: callTasks.priority, dueAt: callTasks.dueAt,
      notes: callTasks.notes, leadId: leads.id, name: leads.name, phone: leads.phone,
      category: leads.category, summary: leads.summary, agentName: agents.name,
    })
    .from(callTasks)
    .innerJoin(leads, eq(leads.id, callTasks.leadId))
    .leftJoin(agents, eq(agents.id, callTasks.agentId))
    .where(eq(callTasks.status, 'PENDING'));

  // Most urgent first, then whoever has waited longest.
  const queue = rows.sort((a, b) => b.priority - a.priority || a.dueAt.getTime() - b.dueAt.getTime());
  const now = new Date();
  const due = queue.filter((r) => r.dueAt.getTime() <= now.getTime());
  const later = queue.filter((r) => r.dueAt.getTime() > now.getTime());

  return (
    <div className="space-y-8">
      <LiveRefresh every={10000} />
      <PageHeader
        title="Calls to make"
        description="Ring these people, most urgent first. After each call, tap what happened — the system takes care of the rest."
      />

      {queue.length === 0 && (
        <div className="bg-card rounded-2xl border">
          <Empty icon={Sparkles} title="No calls to make" hint="Everyone is either chatting with Meera or already handled." />
        </div>
      )}

      {due.length > 0 && <CallList title={`Ring now · ${due.length}`} rows={due} now={now} />}
      {later.length > 0 && <CallList title={`Coming up · ${later.length}`} rows={later} now={now} later />}
    </div>
  );
}

/** Reasons whose note adds something beyond the reason itself. */
const INFORMATIVE_NOTES = new Set(['VISIT_CHECK', 'CALLBACK', 'CHASE', 'LATE_STAGE', 'NO_SHOW']);

type Row = {
  id: string; reason: string; priority: number; dueAt: Date; notes: string | null; leadId: string;
  name: string | null; phone: string; category: string | null; summary: string | null; agentName: string | null;
};

function CallList({ title, rows, now, later }: { title: string; rows: Row[]; now: Date; later?: boolean }) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        {later ? <Clock className="text-muted-foreground size-4" /> : <PhoneCall className="size-4 text-amber-700" />}
        {title}
      </h2>
      <div className="grid gap-4 xl:grid-cols-2">
        {rows.map((r) => {
          const why = callReason(r.reason);
          const cat = category(r.category);
          const urgent = r.priority >= PRIORITY_TOP;
          return (
            <article key={r.id} className={`bg-card space-y-4 rounded-2xl border p-5 ${urgent && !later ? 'border-rose-200 shadow-[0_0_0_3px_rgba(244,63,94,0.06)]' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <LeadIdentity id={r.leadId} name={r.name} phone={r.phone} />
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {urgent && <Pill tone="hot">Urgent</Pill>}
                  <Pill tone={cat.tone} dot title={cat.hint}>{cat.label}</Pill>
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-sm font-medium">{why.label}</p>
                <p className="text-muted-foreground text-xs">
                  {later ? `Due ${relativeTime(r.dueAt, now)} · ${formatIST(r.dueAt)}` : `Waiting ${relativeTime(r.dueAt, now).replace(' ago', '')}`}
                  {' · '}{r.agentName ? `for ${r.agentName}` : 'anyone on the team'}
                </p>
              </div>

              {(r.summary || INFORMATIVE_NOTES.has(r.reason) && r.notes) && (
                <p className="bg-muted/70 rounded-xl px-3.5 py-2.5 text-sm leading-relaxed">
                  <span className="text-muted-foreground mb-0.5 block text-[11px] font-medium uppercase tracking-wide">What we know</span>
                  {r.summary || r.notes}
                </p>
              )}

              <Button asChild className="w-full" variant={later ? 'outline' : 'default'}>
                <a href={`tel:+${r.phone}`}><Phone className="size-4" /> Call {formatPhone(r.phone)}</a>
              </Button>

              <MarkCallForm callTaskId={r.id} />
            </article>
          );
        })}
      </div>
    </section>
  );
}
