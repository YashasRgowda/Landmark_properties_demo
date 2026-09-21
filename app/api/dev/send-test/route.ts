import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads } from '@/lib/db/schema';
import { normalisePhone } from '@/lib/phone';
import { sendText } from '@/lib/whatsapp/client';
import { secretMatches, extractSecret } from '@/lib/security/secret';

/**
 * POST /api/dev/send-test  — development only.
 *
 * Sends one WhatsApp text to an existing lead so the send path can be exercised
 * by hand (and by the Phase 3 verification script). Not available in production.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ ok: false, error: 'not available' }, { status: 404 });
  }
  if (!secretMatches(extractSecret(request.headers, ['x-cron-secret']), process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: 'unauthorised' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { phone?: string; body?: string };
  const phone = normalisePhone(body.phone);
  if (!phone) return NextResponse.json({ ok: false, error: 'bad phone' }, { status: 400 });

  const [lead] = await db.select().from(leads).where(eq(leads.phone, phone)).limit(1);
  if (!lead) return NextResponse.json({ ok: false, error: 'no such lead' }, { status: 404 });

  const result = await sendText({ lead, body: body.body ?? 'test message' });
  return NextResponse.json(result, { status: result.ok ? 200 : 200 });
}
