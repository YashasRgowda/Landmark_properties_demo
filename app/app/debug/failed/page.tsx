import Link from 'next/link';
import { and, desc, eq, gt, isNotNull, isNull, or } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/require';
import { db } from '@/lib/db';
import { leads, tasks } from '@/lib/db/schema';
import { queueEnv, MAX_ATTEMPTS } from '@/lib/queue-policy';
import { dismissTask, retryTask } from '@/lib/actions/failed';
import { formatPhone } from '@/lib/phone';
import { formatIST } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata = { title: 'Failed jobs · Landmark System 1' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** What each job does, for a person rather than a programmer. */
const JOB: Record<string, string> = {
  PROCESS_WA_EVENT: 'Handle a WhatsApp message',
  SEND_FIRST_MESSAGE: 'Send a new lead his first WhatsApp',
  CHECK_DELIVERY: 'Check whether the first WhatsApp landed',
  CREATE_CALL_TASK: 'Put a call on the queue',
  RUN_READER: 'Score a lead',
  SEND_CHASE_MESSAGE: 'Send a follow-up',
  SEND_VISIT_REMINDER: 'Send a visit reminder',
  ESCALATE_TO_AGENT: 'Hand a hot lead to an agent',
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

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Failed jobs</h1>
        <p className="text-muted-foreground text-sm">
          Every job is retried {MAX_ATTEMPTS} times, waiting longer each time, before it is given up
          on. Nothing here is lost — retry it or dismiss it.
        </p>
      </div>

      <JobList title={`Gave up (${gaveUp.length})`} rows={gaveUp} empty="Nothing has failed for good." />
      <JobList title={`Failing, will retry (${retrying.length})`} rows={retrying}
        empty="Nothing is failing right now." retrying />
    </div>
  );
}

type Row = {
  id: string; type: string; status: string; attempts: number; lastError: string | null;
  dueAt: Date; createdAt: Date; leadId: string | null; name: string | null; phone: string | null;
};

function JobList({ title, rows, empty, retrying }: { title: string; rows: Row[]; empty: string; retrying?: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 && <p className="text-muted-foreground text-sm">{empty}</p>}
        {rows.map((r) => (
          <div key={r.id} className="space-y-1 border-b pb-3 text-sm last:border-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">
                {JOB[r.type] ?? r.type}{' '}
                <Badge variant="outline">{r.attempts} attempt{r.attempts === 1 ? '' : 's'}</Badge>
                {r.leadId && (
                  <> · <Link href={`/app/leads/${r.leadId}`} className="font-normal hover:underline">
                    {r.name?.trim() || (r.phone ? formatPhone(r.phone) : 'lead')}
                  </Link></>
                )}
              </p>
              <div className="flex gap-2">
                <form action={retryTask}>
                  <input type="hidden" name="taskId" value={r.id} />
                  <Button type="submit" size="sm" variant="outline">{retrying ? 'Retry now' : 'Retry'}</Button>
                </form>
                <form action={dismissTask}>
                  <input type="hidden" name="taskId" value={r.id} />
                  <Button type="submit" size="sm" variant="ghost">Dismiss</Button>
                </form>
              </div>
            </div>
            <p className="bg-muted rounded p-2 font-mono text-xs break-words">{r.lastError ?? 'no error recorded'}</p>
            <p className="text-muted-foreground text-xs">
              Queued {formatIST(r.createdAt)}{retrying && <> · next try {formatIST(r.dueAt)}</>}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
