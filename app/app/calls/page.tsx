import Link from 'next/link';
import { and, asc, eq } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/require';
import { db } from '@/lib/db';
import { agents, callTasks, leads, PRIORITY_TOP } from '@/lib/db/schema';
import { formatPhone } from '@/lib/phone';
import { formatIST } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MarkCallForm } from './mark-call-form';

export const metadata = { title: 'Calls · Landmark System 1' };
export const dynamic = 'force-dynamic';

const REASON_LABEL: Record<string, string> = {
  PHONE_ONLY: 'Not on WhatsApp',
  DELIVERED_UNREAD: 'Has not opened the message',
  READ_NO_REPLY: 'Read it, did not reply',
  HOT_LEAD: 'HOT — call now',
  CHASE: 'Chase step',
  NO_SHOW: 'Missed the site visit',
  LATE_STAGE: 'Was close to buying — ring today',
  VISIT_CHECK: 'Visit time passed — did he come?',
  CALLBACK: 'Asked to be called back',
};

export default async function CallsPage() {
  await requireUser('/app/calls');

  // The queue order the spec asks for: priority first, then oldest due.
  const rows = await db
    .select({
      id: callTasks.id,
      reason: callTasks.reason,
      priority: callTasks.priority,
      dueAt: callTasks.dueAt,
      notes: callTasks.notes,
      leadId: leads.id,
      name: leads.name,
      phone: leads.phone,
      language: leads.language,
      category: leads.category,
      summary: leads.summary,
      agentName: agents.name,
    })
    .from(callTasks)
    .innerJoin(leads, eq(leads.id, callTasks.leadId))
    .leftJoin(agents, eq(agents.id, callTasks.agentId))
    .where(eq(callTasks.status, 'PENDING'))
    .orderBy(asc(callTasks.priority), asc(callTasks.dueAt));

  // Priority is stored low-to-high for sorting convenience elsewhere, but the
  // agent wants the urgent ones first.
  const queue = [...rows].sort(
    (a, b) => b.priority - a.priority || a.dueAt.getTime() - b.dueAt.getTime(),
  );

  const now = Date.now();
  const due = queue.filter((r) => r.dueAt.getTime() <= now);
  const later = queue.filter((r) => r.dueAt.getTime() > now);

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Calls</h1>
        <p className="text-muted-foreground text-sm">
          {due.length} to ring now
          {later.length > 0 && `, ${later.length} scheduled for later`}.
        </p>
      </div>

      {queue.length === 0 && (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            Nothing to call. Every lead is either talking to Meera or already handled.
          </CardContent>
        </Card>
      )}

      {due.length > 0 && <CallList title="Ring now" rows={due} />}
      {later.length > 0 && <CallList title="Later today" rows={later} muted />}
    </main>
  );
}

type Row = {
  id: string;
  reason: string;
  priority: number;
  dueAt: Date;
  notes: string | null;
  leadId: string;
  name: string | null;
  phone: string;
  language: string | null;
  category: string | null;
  summary: string | null;
  agentName: string | null;
};

function CallList({ title, rows, muted }: { title: string; rows: Row[]; muted?: boolean }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium tracking-wide uppercase">{title}</h2>
      {rows.map((row) => (
        <Card key={row.id} className={muted ? 'opacity-70' : undefined}>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">
                <Link href={`/app/leads/${row.leadId}`} className="hover:underline">
                  {row.name?.trim() || formatPhone(row.phone)}
                </Link>
              </CardTitle>
              <div className="flex items-center gap-2">
                {row.priority >= PRIORITY_TOP && <Badge>Top priority</Badge>}
                {row.category === 'HOT' && <Badge>HOT</Badge>}
                <Badge variant="outline">{REASON_LABEL[row.reason] ?? row.reason}</Badge>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-3">
            <dl className="text-muted-foreground grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div>
                <dt className="inline font-medium">Phone: </dt>
                <dd className="inline">
                  <a href={`tel:+${row.phone}`} className="hover:underline">{formatPhone(row.phone)}</a>
                </dd>
              </div>
              <div>
                <dt className="inline font-medium">Due: </dt>
                <dd className="inline">{formatIST(row.dueAt)}</dd>
              </div>
              {row.language && (
                <div>
                  <dt className="inline font-medium">Speaks: </dt>
                  <dd className="inline capitalize">{row.language}</dd>
                </div>
              )}
              {row.agentName && (
                <div>
                  <dt className="inline font-medium">Owner: </dt>
                  <dd className="inline">{row.agentName}</dd>
                </div>
              )}
            </dl>

            {(row.summary || row.notes) && (
              <p className="bg-muted rounded-md p-3 text-sm">{row.summary || row.notes}</p>
            )}

            <MarkCallForm callTaskId={row.id} />
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
