import { requireUser } from '@/lib/auth/require';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata = { title: 'Today · Landmark System 1' };

export default async function TodayPage() {
  const session = await requireUser('/app');

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Today</h1>
      <Card>
        <CardHeader>
          <CardTitle>Phase 0 — foundation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <p>Signed in as {session.email} ({session.role}).</p>
          <p>Lead intake arrives in Phase 1; this dashboard is filled in at Phase 7.</p>
        </CardContent>
      </Card>
    </div>
  );
}
