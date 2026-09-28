import Link from 'next/link';
import { and, count, desc, eq, ilike, isNull, like, type SQL } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/require';
import { db } from '@/lib/db';
import { CATEGORIES, LEAD_STATUSES, leads, touches } from '@/lib/db/schema';
import { hasAnyFilter, parseLeadFilters } from '@/lib/leads/filters';
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
  const params = await props.searchParams;
  const highlightId = typeof params.highlight === 'string' ? params.highlight : undefined;
  const f = parseLeadFilters(params);

  const where: SQL[] = [];
  if (f.category === 'NONE') where.push(isNull(leads.category));
  else if (f.category) where.push(eq(leads.category, f.category));
  if (f.status) where.push(eq(leads.status, f.status));
  if (f.source) where.push(eq(leads.source, f.source));
  if (f.phoneDigits) where.push(like(leads.phone, `%${f.phoneDigits}%`));
  if (f.nameText) where.push(ilike(leads.name, `%${f.nameText.replace(/[%_\\]/g, '\\$&')}%`));

  const sources = await db.selectDistinct({ source: leads.source }).from(leads).orderBy(leads.source);

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
    .where(where.length ? and(...where) : undefined)
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
              ? hasAnyFilter(f) ? 'No leads match.' : 'No leads yet.'
              : `${rows.length} lead${rows.length === 1 ? '' : 's'}${hasAnyFilter(f) ? ' matching' : ''}, newest first.`}
          </p>
        </div>
        <Button asChild>
          <Link href="/app/leads/new">Add lead</Link>
        </Button>
      </div>

      <form className="flex flex-wrap items-end gap-2 text-sm" action="/app/leads">
        <input
          name="q"
          defaultValue={typeof params.q === 'string' ? params.q : ''}
          placeholder="Phone or name"
          className="border-input h-9 w-48 rounded-md border bg-transparent px-3"
        />
        <select name="category" defaultValue={f.category ?? ''} className="border-input h-9 rounded-md border bg-transparent px-2">
          <option value="">Any category</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          <option value="NONE">Not scored yet</option>
        </select>
        <select name="status" defaultValue={f.status ?? ''} className="border-input h-9 rounded-md border bg-transparent px-2">
          <option value="">Any status</option>
          {LEAD_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
        </select>
        <select name="source" defaultValue={f.source ?? ''} className="border-input h-9 rounded-md border bg-transparent px-2">
          <option value="">Any source</option>
          {sources.map(({ source }) => <option key={source} value={source}>{source}</option>)}
        </select>
        <Button type="submit" size="sm" variant="outline">Filter</Button>
        {hasAnyFilter(f) && (
          <Link href="/app/leads" className="text-muted-foreground hover:underline">Clear</Link>
        )}
      </form>

      {rows.length === 0 && hasAnyFilter(f) ? (
        <p className="rounded-md border p-6 text-sm text-muted-foreground">Nothing matches those filters.</p>
      ) : rows.length === 0 ? (
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
                  <TableCell className="font-medium">
                    <Link href={`/app/leads/${lead.id}`} className="hover:underline">
                      {lead.name || formatPhone(lead.phone)}
                    </Link>
                  </TableCell>
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
