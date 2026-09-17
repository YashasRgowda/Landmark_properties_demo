'use client';

import { useState, useTransition } from 'react';
import { runWorkerNow, type DebugState } from '@/lib/actions/debug';
import { Button } from '@/components/ui/button';

export function WorkerPanel() {
  const [state, setState] = useState<DebugState>({});
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      setState(await runWorkerNow());
    });
  }

  const report = state.report;

  return (
    <div className="space-y-3">
      <Button onClick={run} disabled={pending}>
        {pending ? 'Running…' : 'Run worker now'}
      </Button>

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      {report ? (
        <div className="space-y-2 rounded-md border p-4 text-sm">
          <p className="font-medium">
            Claimed {report.claimed} · done {report.done} · retry {report.retry} · failed{' '}
            {report.failed}
            {report.rescued > 0 ? ` · rescued ${report.rescued}` : ''} ·{' '}
            <span className="text-muted-foreground">{report.durationMs} ms</span>
          </p>

          {report.claimed === 0 ? (
            <p className="text-muted-foreground">Nothing was due.</p>
          ) : (
            <ul className="space-y-1">
              {report.tasks.map((t) => (
                <li key={t.id} className="font-mono text-xs">
                  <span
                    className={
                      t.status === 'DONE'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : t.status === 'RETRY'
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-destructive'
                    }
                  >
                    {t.status}
                  </span>{' '}
                  {t.type} · attempt {t.attempts}
                  {t.retryAt ? ` · retry at ${new Date(t.retryAt).toLocaleTimeString()}` : ''}
                  {t.error ? ` · ${t.error}` : ''}
                  {t.logs?.length ? ` · ${t.logs.join('; ')}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
