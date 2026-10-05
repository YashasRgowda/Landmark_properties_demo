import Link from 'next/link';
import { and, desc, eq, gt, isNotNull, isNull, or } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/require';
import { db } from '@/lib/db';
import { leads, tasks } from '@/lib/db/schema';
import { queueEnv, MAX_ATTEMPTS } from '@/lib/queue-policy';
import { dismissTask, retryTask } from '@/lib/actions/failed';
import { formatPhone } from '@/lib/phone';
import { formatIST } from '@/lib/format';
import { relativeTime } from '@/lib/labels';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/app/page-header';
import { Panel } from '@/components/app/panel';
import { Pill } from '@/components/app/pill';

export const metadata = { title: 'System health · Landmark Lead Desk' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** What each job does, for a person rather than a programmer. */
const JOB: Record<string, string> = {
  PROCESS_WA_EVENT: 'Handle a WhatsApp message',
  SEND_FIRST_MESSAGE: 'Send a new buyer their first WhatsApp',
  CHECK_DELIVERY: 'Check whether the first WhatsApp landed',
  CREATE_CALL_TASK: 'Add a call to the list',
  RUN_READER: 'Read a chat and judge interest',
  SEND_CHASE_MESSAGE: 'Send a follow-up',
  SEND_VISIT_REMINDER: 'Send a visit reminder',
  ESCALATE_TO_AGENT: 'Hand a ready buyer to an agent',
  ADVANCE_CHASE: 'Move a follow-up to its next step',
};

/**
 * The dead-letter view: jobs that failed, and jobs failing and being retried.
 *
 * This works in production, unlike the rest of /app/debug — production is
 * where jobs actually fail, and a failure nobody can see is a buyer nobody
 * answered.
 */
export default async function FailedJobsPage() {
  await requireAdmin('/app/debug/failed');

  const env = queueEnv();
  const own = env === 'production' ? or(eq(tasks.env, env), isNull(tasks.env))! : eq(tasks.env, env);
  const cols = {
    id: tasks.id, type: tasks.type, status: tasks.status, attempts: tasks.attempts,
    lastError: tasks.lastError, dueAt: tasks.dueAt, createdAt: tasks.createdAt,
    leadId: leads.id, name: leads.name, phone: leads.phone,
  };

  const [gaveUp, retrying] = await Promise.all([
    db.select(cols).from(tasks).leftJoin(leads, eq(leads.id, tasks.leadId))
      .where(and(eq(tasks.status, 'FAILED'), own)).orderBy(desc(tasks.createdAt)).limit(100),
    db.select(cols).from(tasks).leftJoin(leads, eq(leads.id, tasks.leadId))
      .where(and(eq(tasks.status, 'PENDING'), gt(tasks.attempts, 0), isNotNull(tasks.lastError), own))
      .orderBy(desc(tasks.createdAt)).limit(100),
  ]);

  const healthy = gaveUp.length === 0 && retrying.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="System health"
        description={`Behind the scenes, small jobs run every minute — answering WhatsApps, sending follow-ups, adding calls. If one fails, it is tried again up to ${MAX_ATTEMPTS} times on its own.`}
      />

      {healthy ? (
        <div className="flex items-center gap-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-6">
          <span className="inline-flex size-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <CheckCircle2 className="size-6" />
          </span>
          <div>
            <p className="font-semibold text-emerald-900">Everything is running smoothly</p>
            <p className="text-sm text-emerald-800/80">No job has failed. Nothing needs your attention.</p>
          </div>
        </div>
      ) : (
        <>
          <JobList icon={AlertTriangle} title={`Stopped after retrying · ${gaveUp.length}`}
            description="These were tried several times and then stopped. Press “Try again” once the cause is fixed — nothing is lost."
            rows={gaveUp} empty="Nothing has stopped." />
          <JobList icon={RefreshCw} title={`Having trouble — retrying on its own · ${retrying.length}`}
            description="Usually a short hiccup (WhatsApp or the AI was slow). No action needed unless it ends up above."
            rows={retrying} empty="Nothing is retrying right now." retrying />
        </>
      )}
    </div>
  );
}

type Row = {
  id: string; type: string; status: string; attempts: number; lastError: string | null;
  dueAt: Date; createdAt: Date; leadId: string | null; name: string | null; phone: string | null;
};

function JobList({ title, description, icon, rows, empty, retrying }: {
  title: string; description: string; icon: typeof AlertTriangle; rows: Row[]; empty: string; retrying?: boolean;
}) {
  return (
    <Panel icon={icon} title={title} description={description} tone={!retrying && rows.length ? 'urgent' : undefined}>
      {rows.length === 0 && <p className="text-muted-foreground py-4 text-sm">{empty}</p>}
      <ul className="divide-y">
        {rows.map((r) => (
          <li key={r.id} className="space-y-2 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{JOB[r.type] ?? r.type}</span>
                {r.leadId && (
                  <Link href={`/app/leads/${r.leadId}`} className="text-primary hover:underline">
                    for {r.name?.trim() || (r.phone ? formatPhone(r.phone) : 'a buyer')}
                  </Link>
                )}
                <Pill tone={retrying ? 'warm' : 'bad'}>tried {r.attempts} time{r.attempts === 1 ? '' : 's'}</Pill>
              </div>
              <div className="flex gap-2">
                <form action={retryTask}>
                  <input type="hidden" name="taskId" value={r.id} />
                  <Button type="submit" size="sm" variant="outline">{retrying ? 'Try now' : 'Try again'}</Button>
                </form>
                <form action={dismissTask}>
                  <input type="hidden" name="taskId" value={r.id} />
                  <Button type="submit" size="sm" variant="ghost">Dismiss</Button>
                </form>
              </div>
            </div>
            <details className="text-xs">
              <summary className="text-muted-foreground cursor-pointer">
                Started {relativeTime(r.createdAt)}{retrying && <> · next try {relativeTime(r.dueAt)}</>} · technical details
              </summary>
              <p className="bg-muted mt-2 rounded p-2 font-mono break-words">{r.lastError ?? 'no error recorded'}</p>
              <p className="text-muted-foreground mt-1">Queued {formatIST(r.createdAt)}</p>
            </details>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
