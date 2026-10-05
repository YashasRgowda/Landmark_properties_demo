'use client';

import { useActionState } from 'react';
import { addAgent, type AgentFormState } from '@/lib/actions/agents';
import { AGENT_LANGUAGES } from '@/lib/agents/languages';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function AddAgentForm() {
  const [state, action, pending] = useActionState<AgentFormState, FormData>(addAgent, {});

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-3"><CardTitle className="text-base">Add someone to the team</CardTitle></CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" placeholder="98450 00000" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="email">Email (optional)</Label>
              <Input id="email" name="email" type="email" />
            </div>
          </div>
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">Languages they speak</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              {AGENT_LANGUAGES.map((l) => (
                <label key={l} className="flex items-center gap-2 capitalize">
                  <input type="checkbox" name="languages" value={l} defaultChecked={l === 'english'} />
                  {l}
                </label>
              ))}
            </div>
          </fieldset>
          {state.errors && (
            <ul className="text-destructive list-disc pl-5 text-sm">
              {state.errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
          {state.added && <p className="text-sm text-emerald-700">{state.added} is on the team. New buyers can go to them now.</p>}
          <Button type="submit" disabled={pending}>{pending ? 'Adding…' : 'Add to team'}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
