'use client';

import { useActionState } from 'react';
import { saveProject, type SaveProjectState } from '@/lib/actions/project';
import { PLOT_ROWS, type ProjectForm } from '@/lib/project-validate';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export function ProjectEditor({ initial }: { initial: ProjectForm }) {
  const [state, action, pending] = useActionState<SaveProjectState, FormData>(saveProject, {});
  // After a save — good or bad — show what was submitted, not the originals.
  const v = state.values ?? initial;

  const field = (name: string, label: string, hint?: string) => (
    <div className="space-y-1">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} defaultValue={v[name] ?? ''} />
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
  const area = (name: string, label: string, hint?: string, rows = 4) => (
    <div className="space-y-1">
      <Label htmlFor={name}>{label}</Label>
      <Textarea id={name} name={name} defaultValue={v[name] ?? ''} rows={rows} />
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );

  return (
    <form action={action} className="space-y-4">
      <Status state={state} pending={pending} />

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Plots</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="text-muted-foreground grid grid-cols-[1fr_1fr_1fr_1fr_1.4fr] gap-2 text-xs font-medium">
            <span>Size</span><span>Sq ft</span><span>Price</span><span>Available</span><span>Facing</span>
          </div>
          {Array.from({ length: PLOT_ROWS }, (_, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_1fr_1.4fr] gap-2">
              <Input name={`plot_size_${i}`} defaultValue={v[`plot_size_${i}`] ?? ''} placeholder="30x40" aria-label={`Row ${i + 1} size`} />
              <Input name={`plot_sqft_${i}`} defaultValue={v[`plot_sqft_${i}`] ?? ''} placeholder="1200" aria-label={`Row ${i + 1} sq ft`} />
              <Input name={`plot_price_${i}`} defaultValue={v[`plot_price_${i}`] ?? ''} placeholder="₹42 lakh" aria-label={`Row ${i + 1} price`} />
              <Input name={`plot_available_${i}`} defaultValue={v[`plot_available_${i}`] ?? ''} placeholder="14" aria-label={`Row ${i + 1} available`} />
              <Input name={`plot_facing_${i}`} defaultValue={v[`plot_facing_${i}`] ?? ''} placeholder="East and North" aria-label={`Row ${i + 1} facing`} />
            </div>
          ))}
          <p className="text-muted-foreground text-xs">
            Leave a row&apos;s size empty to remove it. The starting price Meera quotes is worked out from
            the cheapest plot.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Prices and offers</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {field('price_per_sqft', 'Rate per sq ft', 'e.g. ₹3,500 per sq ft')}
          {field('booking_amount', 'Booking amount')}
          {field('offer_description', 'Approved offer', 'The most Meera may offer. She will never go beyond it.')}
          {field('floor_price_per_sqft', 'Lowest rate allowed', 'e.g. ₹3,400 per sq ft. Anything lower goes to the sales head.')}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Approvals and registration</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {field('dc_conversion', 'DC conversion')}
          {field('e_khata', 'E-Khata')}
          {field('rera', 'RERA')}
          {field('bank_approvals', 'Banks that give loans', 'Separate with commas')}
          {field('possession', 'Possession')}
          {field('registration', 'Registration')}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Site visits</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {field('site_timings', 'Site timings (as Meera says it)', 'e.g. 10 AM to 6 PM, all seven days')}
          <div className="grid grid-cols-2 gap-2">
            {field('site_open_hour', 'Opens at (hour)', '0–23, e.g. 10')}
            {field('site_close_hour', 'Closes at (hour)', 'e.g. 18 for 6 PM')}
          </div>
          {field('site_address', 'Site address')}
          {field('maps_link', 'Map link')}
          {field('pickup', 'Pickup offer')}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Project and sales head</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {field('name', 'Project name')}
          {field('developer', 'Developer')}
          {field('location', 'Location')}
          {field('landmark', 'Landmark / distances')}
          {field('total_area', 'Total area')}
          {field('survey_number', 'Survey number')}
          {field('sales_head_name', 'Sales head name')}
          {field('sales_head_phone', 'Sales head phone')}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Lists</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          {area('amenities', 'Amenities', 'One per line')}
          {area('documents_available', 'Documents Meera may send', 'One per line. Only documents the system has a file for.')}
          {area('never', 'Things Meera must never do', 'One per line')}
        </CardContent>
      </Card>

      <Status state={state} pending={pending} />
      <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button>
    </form>
  );
}

function Status({ state, pending }: { state: SaveProjectState; pending: boolean }) {
  if (pending) return null;
  return (
    <>
      {state.errors && state.errors.length > 0 && (
        <div className="border-destructive text-destructive space-y-1 rounded-md border p-3 text-sm">
          <p className="font-medium">Not saved — fix these first:</p>
          <ul className="list-disc pl-5">{state.errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
      {state.savedAt && (
        <p className="rounded-md border border-green-600/40 bg-green-600/10 p-3 text-sm">
          Saved. Meera uses this from her next message.
        </p>
      )}
      {state.warnings && state.warnings.length > 0 && (
        <div className="space-y-1 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">{state.savedAt ? 'Saved, but check:' : 'Also worth checking:'}</p>
          <ul className="list-disc pl-5">{state.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
    </>
  );
}
