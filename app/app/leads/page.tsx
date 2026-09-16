import Link from 'next/link';
import { count, desc, eq } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/require';
import { db } from '@/lib/db';
import { leads, touches } from '@/lib/db/schema';
import { formatPhone } from '@/lib/phone';
import { formatIST } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const metadata = { title: 'Leads · Landmark System 1' };
export const dynamic = 'force-dynamic';

const CATEGORY_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  HOT: 'default',
  WARM: 'secondary',
  COLD: 'outline',
  REJECT: 'destructive',
};

export default async function LeadsPage(props: PageProps<'/app/leads'>) {
  await requireUser('/app/leads');
  const { highlight } = await props.searchParams;
  const highlightId = typeof highlight === 'string' ? highlight : undefined;

  // Touch count is derived from the touches table, never a stored counter
  // (golden rule 8). Done as an explicit join rather than a correlated
  // subquery: Drizzle renders single-table subqueries with unqualified column
  // names, and `touches.id` would silently shadow `leads.id`.
  const rows = await db
    .select({
      id: leads.id,
      name: leads.name,
      phone: leads.phone,
      source: leads.source,
      status: leads.status,
      category: leads.category,
      createdAt: leads.createdAt,
      touchCount: count(touches.id),
    })
    .from(leads)
    .leftJoin(touches, eq(touches.leadId, leads.id))
    .groupBy(leads.id)
    .orderBy(desc(leads.createdAt))
    .limit(200);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Leads</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length === 0
              ? 'No leads yet.'
              : `${rows.length} lead${rows.length === 1 ? '' : 's'}, newest first.`}
          </p>
        </div>
        <Button asChild>
          <Link href="/app/leads/new">Add lead</Link>
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md border p-6 text-sm text-muted-foreground">
          Nothing here yet. Add one manually, or POST to{' '}
          <code className="text-xs">/api/leads/intake</code>.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Touches</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((lead) => (
                <TableRow
                  key={lead.id}
                  className={lead.id === highlightId ? 'bg-muted/60' : undefined}
                >
                  <TableCell className="font-medium">{lead.name || '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{formatPhone(lead.phone)}</TableCell>
                  <TableCell>{lead.source}</TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground">{lead.status}</span>
                  </TableCell>
                  <TableCell>
                    {lead.category ? (
                      <Badge variant={CATEGORY_VARIANT[lead.category] ?? 'outline'}>
                        {lead.category}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{lead.touchCount}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatIST(lead.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
