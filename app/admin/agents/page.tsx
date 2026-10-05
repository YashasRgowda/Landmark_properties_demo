import { asc, sql } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/require';
import { db } from '@/lib/db';
import { agents, callTasks, leads } from '@/lib/db/schema';
import { setAgentActive } from '@/lib/actions/agents';
import { formatPhone } from '@/lib/phone';
import { LANGUAGE } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/app/page-header';
import { Empty, Panel } from '@/components/app/panel';
import { Pill } from '@/components/app/pill';
import { Avatar } from '@/components/app/lead-identity';
import { AddAgentForm } from './add-agent-form';

export const metadata = { title: 'Sales team · Landmark Lead Desk' };
export const dynamic = 'force-dynamic';

export default async function AdminAgentsPage() {
  await requireAdmin('/admin/agents');

  const rows = await db
    .select({
      id: agents.id,
      name: agents.name,
      phone: agents.phone,
      email: agents.email,
      languages: agents.languages,
      active: agents.active,
      openLeads: sql<number>`(select count(*)::int from ${leads} l where l.owner_agent_id = ${agents.id}
        and l.status not in ('WON', 'LOST', 'REJECTED'))`,
      callsWaiting: sql<number>`(select count(*)::int from ${callTasks} c where c.agent_id = ${agents.id}
        and c.status = 'PENDING')`,
    })
    .from(agents)
    .orderBy(asc(agents.name));

  const activeCount = rows.filter((a) => a.active).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Sales team"
        description="When a buyer is ready, Meera hands them to someone here — first to an agent who speaks the buyer's language, then to whoever has the fewest buyers."
      />

      <Panel icon={Users} title={`${activeCount} active agent${activeCount === 1 ? '' : 's'}`}
        description="Taking someone off the team hands their buyers and calls back to everyone else.">
        {rows.length === 0 ? (
          <Empty icon={Users} title="No one on the team yet" hint="Until you add someone, ready buyers have nobody to go to." />
        ) : (
          <ul className="divide-y">
            {rows.map((a) => (
              <li key={a.id} className={cn('flex flex-wrap items-center gap-4 py-3', !a.active && 'opacity-60')}>
                <Avatar name={a.name} seed={a.id} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {a.name} {!a.active && <Pill tone="neutral">Off the team</Pill>}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {a.phone ? formatPhone(a.phone) : 'No phone added'} · Speaks{' '}
                    {a.languages.map((l) => LANGUAGE[l] ?? l).join(', ')}
                  </p>
                </div>
                <div className="flex gap-6 text-center">
                  <div><p className="text-lg font-semibold tabular-nums">{a.openLeads}</p><p className="text-muted-foreground text-xs">buyers</p></div>
                  <div><p className="text-lg font-semibold tabular-nums">{a.callsWaiting}</p><p className="text-muted-foreground text-xs">calls to make</p></div>
                </div>
                <div className="w-36 text-right">
                  {a.active && activeCount === 1 ? (
                    <span className="text-muted-foreground text-xs">The last active agent</span>
                  ) : (
                    <form action={setAgentActive}>
                      <input type="hidden" name="agentId" value={a.id} />
                      <input type="hidden" name="active" value={a.active ? 'false' : 'true'} />
                      <Button type="submit" size="sm" variant="outline">
                        {a.active ? 'Take off team' : 'Bring back'}
                      </Button>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <AddAgentForm />
    </div>
  );
}
