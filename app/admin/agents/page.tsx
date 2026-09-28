import { asc, sql } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/require';
import { db } from '@/lib/db';
import { agents, callTasks, leads } from '@/lib/db/schema';
import { setAgentActive } from '@/lib/actions/agents';
import { formatPhone } from '@/lib/phone';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AddAgentForm } from './add-agent-form';

export const metadata = { title: 'Agents · Admin' };
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
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Agents</h1>
        <p className="text-muted-foreground text-sm">
          The people hot leads are handed to. A buyer goes to someone who speaks his language, then
          to whoever has the fewest leads.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{activeCount} active agent{activeCount === 1 ? '' : 's'}</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No agents yet. Until you add one, hot leads have nobody to go to.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Languages</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead className="text-right">Open leads</TableHead>
                    <TableHead className="text-right">Calls waiting</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((a) => (
                    <TableRow key={a.id} className={a.active ? undefined : 'opacity-60'}>
                      <TableCell className="font-medium">
                        {a.name}{' '}
                        {!a.active && <Badge variant="outline">Inactive</Badge>}
                      </TableCell>
                      <TableCell className="capitalize">{a.languages.join(', ')}</TableCell>
                      <TableCell className="font-mono text-xs">{a.phone ? formatPhone(a.phone) : '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{a.openLeads}</TableCell>
                      <TableCell className="text-right tabular-nums">{a.callsWaiting}</TableCell>
                      <TableCell className="text-right">
                        {a.active && activeCount === 1 ? (
                          <span className="text-muted-foreground text-xs">The last active agent</span>
                        ) : (
                          <form action={setAgentActive}>
                            <input type="hidden" name="agentId" value={a.id} />
                            <input type="hidden" name="active" value={a.active ? 'false' : 'true'} />
                            <Button type="submit" size="sm" variant="outline">
                              {a.active ? 'Deactivate' : 'Bring back'}
                            </Button>
                          </form>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="text-muted-foreground mt-3 text-xs">
            Deactivating someone hands their open leads and waiting calls back to the team.
          </p>
        </CardContent>
      </Card>

      <AddAgentForm />
    </div>
  );
}
