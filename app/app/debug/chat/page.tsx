import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/require';
import { getSimState } from '@/lib/actions/simulator';
import { ChatPanel } from './chat-panel';

export const metadata = { title: 'WhatsApp simulator · Landmark System 1' };
export const dynamic = 'force-dynamic';

export default async function ChatSimulatorPage() {
  await requireAdmin('/app/debug/chat');
  if (process.env.NODE_ENV === 'production') notFound();

  const initial = await getSimState();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">WhatsApp simulator</h1>
        <p className="text-sm text-muted-foreground">
          The same Meera, the same scoring, the same rules as the live system — without Meta.
          Nothing here is actually delivered.{' '}
          <Link href="/app/debug" className="underline">
            Queue debug
          </Link>
        </p>
      </div>
      <ChatPanel initial={initial} />
    </div>
  );
}
