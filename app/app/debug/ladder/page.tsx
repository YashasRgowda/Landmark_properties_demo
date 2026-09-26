import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/require';
import { getLadderState } from '@/lib/actions/ladder';
import { LadderPanel } from './ladder-panel';

export const metadata = { title: 'First-hour ladder · Landmark System 1' };
export const dynamic = 'force-dynamic';

export default async function LadderPage() {
  await requireAdmin('/app/debug/ladder');
  if (process.env.NODE_ENV === 'production') notFound();

  return <LadderPanel initial={await getLadderState()} />;
}
