'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import {
  fastForwardCalls,
  resetLadder,
  runScenario,
  type LadderRow,
  type ScenarioKey,
} from '@/lib/actions/ladder';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/** What each scenario is meant to prove, in the words of the flowchart. */
const EXPECTED: Record<ScenarioKey, string> = {
  NOT_ON_WHATSAPP:
    'Phone is the only way to reach him → call at the TOP of the queue. Office hours: now. Otherwise 9:30 AM.',
  DELIVERED: 'He is busy → a call due in 10 minutes. Evening: now. Night: 9:30 AM.',
  READ: 'He made a choice → a call due in 15 minutes. Evening: now. Night: 9:30 AM.',
  REPLIED: 'Meera has him → NO call at all.',
};

export function LadderPanel({ initial }: { initial: LadderRow[] }) {
  const [rows, setRows] = useState(initial);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<LadderRow[]>) => start(async () => setRows(await fn()));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">The first-hour ladder</h1>
        <p className="text-muted-foreground text-sm">
          One click runs a scenario end to end. The decision table, the call
          rules and the agent’s queue are the real ones — only the WhatsApp
          delivery and Meta’s receipt are simulated, because there is no Meta
          here.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => run(fastForwardCalls)} disabled={pending} variant="outline" size="sm">
          Skip the 10/15 minute wait
        </Button>
        <Button onClick={() => run(resetLadder)} disabled={pending} variant="outline" size="sm">
          Clear all test leads
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/app/calls">Open the agent’s queue →</Link>
        </Button>
      </div>

      <div className="grid gap-4">
        {rows.map((row) => (
          <Card key={row.scenario}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">{row.label}</CardTitle>
                <Button
                  onClick={() => run(() => runScenario(row.scenario))}
                  disabled={pending}
                  size="sm"
                >
                  Run this
                </Button>
              </div>
              <p className="text-muted-foreground text-sm">{EXPECTED[row.scenario]}</p>
            </CardHeader>

            <CardContent className="space-y-2 text-sm">
              {!row.leadId && <p className="text-muted-foreground">Not run yet.</p>}

              {row.leadId && (
                <>
                  <p className="text-muted-foreground">
                    Lead status <strong>{row.leadStatus}</strong> · WhatsApp{' '}
                    <strong>{row.waState ?? 'unknown'}</strong> · opening message{' '}
                    {row.messageSent ? 'recorded' : 'not sent'}
                  </p>

                  {row.call ? (
                    <div className="bg-muted space-y-1 rounded-md p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge>Call created</Badge>
                        <Badge variant="outline">{row.call.reason}</Badge>
                        {row.call.priority >= 10 && <Badge>Top priority</Badge>}
                        {row.call.agentName && (
                          <Badge variant="secondary">{row.call.agentName}</Badge>
                        )}
                      </div>
                      <p>
                        Due{' '}
                        <strong>
                          {row.call.minutesFromNow <= 0
                            ? 'now'
                            : row.call.minutesFromNow < 90
                              ? `in ${row.call.minutesFromNow} minutes`
                              : `in ${Math.round(row.call.minutesFromNow / 60)} hours`}
                        </strong>{' '}
                        — {row.call.dueAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST
                      </p>
                      {row.call.notes && (
                        <p className="text-muted-foreground">“{row.call.notes}”</p>
                      )}
                    </div>
                  ) : (
                    <p className="rounded-md border border-dashed p-3">
                      No call task — {row.scenario === 'REPLIED' ? 'correct, he is talking to Meera.' : 'unexpected.'}
                    </p>
                  )}

                  <Link href={`/app/leads/${row.leadId}`} className="text-muted-foreground hover:underline">
                    See his full history →
                  </Link>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
