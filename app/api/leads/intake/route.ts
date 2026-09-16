import { NextResponse } from 'next/server';
import { parseIntake } from '@/lib/leads/schema';
import { intakeLead } from '@/lib/leads/intake';
import { extractSecret, secretMatches } from '@/lib/security/secret';

/**
 * POST /api/leads/intake
 *
 * The portal-facing entry point. Secured by LEAD_WEBHOOK_SECRET, sent as either
 *   Authorization: Bearer <secret>
 *   x-webhook-secret: <secret>
 *
 * Nothing slow happens here. In Phase 5 this will enqueue SEND_FIRST_MESSAGE;
 * for now it validates, dedupes and records the enquiry (golden rule 4).
 */
export async function POST(request: Request) {
  if (!secretMatches(extractSecret(request.headers), process.env.LEAD_WEBHOOK_SECRET)) {
    return NextResponse.json({ ok: false, error: 'unauthorised' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'body must be JSON' }, { status: 400 });
  }

  const parsed = parseIntake(body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, errors: parsed.errors }, { status: 400 });
  }

  try {
    const result = await intakeLead(parsed.value);
    return NextResponse.json(
      {
        ok: true,
        leadId: result.lead.id,
        phone: result.lead.phone,
        created: result.created,
        duplicate: !result.created,
        enriched: result.enriched,
        warnings: [...parsed.warnings, ...result.warnings],
      },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    // One bad lead must never take the endpoint down for the next one.
    console.error('[intake] failed', error);
    return NextResponse.json({ ok: false, error: 'could not record the enquiry' }, { status: 500 });
  }
}
