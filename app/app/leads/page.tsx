import Link from 'next/link';
import { and, desc, eq, ilike, isNull, like, type SQL } from 'drizzle-orm';
import { Plus, Search, Users } from 'lucide-react';
import { requireUser } from '@/lib/auth/require';
import { db } from '@/lib/db';
import { agents, CATEGORIES, LEAD_STATUSES, leads } from '@/lib/db/schema';
import { hasAnyFilter, parseLeadFilters } from '@/lib/leads/filters';
import { CATEGORY, category, leadStatus, relativeTime, sourceName } from '@/lib/labels';
import { PageHeader } from '@/components/app/page-header';
import { LeadIdentity } from '@/components/app/lead-identity';
import { Pill } from '@/components/app/pill';
import { Empty } from '@/components/app/panel';
import { Button } from '@/components/ui/button';

export const metadata = { title: 'Leads · Landmark Lead Desk' };
export const dynamic = 'force-dynamic';

const field = 'border-input bg-card h-10 rounded-lg border px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40';

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

  const [rows, sources] = await Promise.all([
    db.select({
      id: leads.id, name: leads.name, phone: leads.phone, source: leads.source, status: leads.status,
      category: leads.category, summary: leads.summary, createdAt: leads.createdAt,
      lastContactAt: leads.lastContactAt, owner: agents.name,
    })
      .from(leads).leftJoin(agents, eq(agents.id, leads.ownerAgentId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(leads.createdAt)).limit(200),
    db.selectDistinct({ source: leads.source }).from(leads).orderBy(leads.source),
  ]);
  const filtered = hasAnyFilter(f);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads"
        description="Every enquiry, newest first. Click anyone to see their full story."
        actions={<Button asChild><Link href="/app/leads/new"><Plus className="size-4" /> Add a lead</Link></Button>}
      />

      <form action="/app/leads" className="bg-card flex flex-wrap items-center gap-2 rounded-2xl border p-3">
        <div className="relative min-w-56 flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <input name="q" defaultValue={typeof params.q === 'string' ? params.q : ''}
            placeholder="Search by name or phone number" className={`${field} w-full pl-9`} />
        </div>
        <select name="category" defaultValue={f.category ?? ''} className={field} aria-label="How interested">
          <option value="">Any interest level</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY[c].label} — {CATEGORY[c].hint}</option>)}
          <option value="NONE">New — not judged yet</option>
        </select>
        <select name="status" defaultValue={f.status ?? ''} className={field} aria-label="Where they are">
          <option value="">Any stage</option>
          {LEAD_STATUSES.map((st) => <option key={st} value={st}>{leadStatus(st).label}</option>)}
        </select>
        <select name="source" defaultValue={f.source ?? ''} className={field} aria-label="Where they came from">
          <option value="">Any source</option>
          {sources.map(({ source }) => <option key={source} value={source}>{sourceName(source)}</option>)}
        </select>
        <Button type="submit" variant="outline">Apply</Button>
        {filtered && <Link href="/app/leads" className="text-muted-foreground px-2 text-sm hover:underline">Clear</Link>}
      </form>

      <p className="text-muted-foreground text-sm">
        {rows.length === 0 ? '' : `Showing ${rows.length} lead${rows.length === 1 ? '' : 's'}${filtered ? ' that match' : ''}.`}
      </p>

      {rows.length === 0 ? (
        <div className="bg-card rounded-2xl border">
          <Empty icon={Users}
            title={filtered ? 'Nobody matches those filters' : 'No leads yet'}
            hint={filtered ? 'Try clearing a filter.' : 'Leads from 99acres, MagicBricks and the website appear here the moment they arrive.'} />
        </div>
      ) : (
        <div className="bg-card overflow-hidden rounded-2xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-muted-foreground text-left text-xs">
              <tr>
                <th className="px-5 py-3 font-medium">Buyer</th>
                <th className="px-3 py-3 font-medium">Interest</th>
                <th className="px-3 py-3 font-medium">Where they are</th>
                <th className="hidden px-3 py-3 font-medium md:table-cell">Came from</th>
                <th className="hidden px-3 py-3 font-medium lg:table-cell">Last heard from</th>
                <th className="hidden px-5 py-3 font-medium lg:table-cell">Agent</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((l) => {
                const cat = category(l.category);
                const st = leadStatus(l.status);
                return (
                  <tr key={l.id} className={l.id === highlightId ? 'bg-gold-soft/60' : 'hover:bg-muted/40'}>
                    <td className="max-w-xs px-5 py-3"><LeadIdentity id={l.id} name={l.name} phone={l.phone} /></td>
                    <td className="px-3 py-3"><Pill tone={cat.tone} dot title={cat.hint}>{cat.label}</Pill></td>
                    <td className="px-3 py-3">
                      <span title={st.hint} className="block">{st.label}</span>
                      <span className="text-muted-foreground hidden text-xs xl:block">{st.hint}</span>
                    </td>
                    <td className="text-muted-foreground hidden px-3 py-3 md:table-cell">{sourceName(l.source)}</td>
                    <td className="text-muted-foreground hidden px-3 py-3 lg:table-cell">
                      {l.lastContactAt ? relativeTime(l.lastContactAt) : `Arrived ${relativeTime(l.createdAt)}`}
                    </td>
                    <td className="text-muted-foreground hidden px-5 py-3 lg:table-cell">{l.owner ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
