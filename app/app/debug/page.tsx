import { notFound } from 'next/navigation';
import { desc, sql } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/require';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { enqueueTestTask } from '@/lib/actions/debug';
import { formatIST } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { WorkerPanel } from './worker-panel';

export const metadata = { title: 'Debug · Landmark System 1' };
export const dynamic = 'force-dynamic';

export default async function DebugPage() {
  await requireAdmin('/app/debug');

  // Dev-only, per the build spec.
  if (process.env.NODE_ENV === 'production') notFound();

  const counts = await db
    .select({ status: tasks.status, n: sql<number>`count(*)::int` })
    .from(tasks)
    .groupBy(tasks.status);

  const recent = await db
    .select()
    .from(tasks)
    .orderBy(desc(tasks.createdAt))
    .limit(25);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Debug</h1>
        <p className="text-sm text-muted-foreground">
          The task queue. Available in development only.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Queue</h2>
        <div className="flex flex-wrap gap-4 text-sm">
          {counts.length === 0 ? (
            <span className="text-muted-foreground">No tasks yet.</span>
          ) : (
            counts.map((c) => (
              <span key={c.status} className="rounded-md border px-3 py-1">
                {c.status} <span className="tabular-nums font-medium">{c.n}</span>
              </span>
            ))
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Add a test task</h2>
        <form action={enqueueTestTask} className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="seconds">Due in (seconds)</Label>
            <Input
              id="seconds"
              name="seconds"
              type="number"
              min={0}
              max={3600}
              defaultValue={10}
              className="w-32"
            />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" name="fail" className="size-4" />
            make it fail
          </label>
          <Button type="submit" variant="outline" className="mb-0.5">
            Add task
          </Button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Run the worker</h2>
        <WorkerPanel />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Last 25 tasks</h2>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Attempts</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Last error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    Nothing queued yet.
                  </TableCell>
                </TableRow>
              ) : (
                recent.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs">{t.type}</TableCell>
                    <TableCell className="text-xs">{t.status}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.attempts}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatIST(t.dueAt, 'd MMM, h:mm:ss a')}
                    </TableCell>
                    <TableCell className="max-w-[24rem] truncate text-xs text-muted-foreground">
                      {t.lastError ?? '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
