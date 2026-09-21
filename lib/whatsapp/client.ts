import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads, messages, touches, type Lead } from '@/lib/db/schema';

/**
 * Meta WhatsApp Cloud API.
 *
 * Both send functions refuse to message an opted-out lead. That check lives
 * here, not at the call sites, so no future phase can forget it.
 */

const GRAPH_VERSION = 'v21.0';

/** Meta error codes that mean "this number cannot receive WhatsApp". */
const UNDELIVERABLE_CODES = new Set([131026, 131047, 131051, 131052, 470]);

export type SendResult =
  | { ok: true; waMessageId: string; messageRowId: string }
  | { ok: false; reason: 'OPTED_OUT' | 'NOT_ON_WHATSAPP' | 'FAILED'; error: string };

type SendArgs = {
  lead: Pick<Lead, 'id' | 'phone' | 'optedOut'>;
  /** Used to make a retry safe: the same key never sends twice. */
  idempotencyKey?: string | null;
};

function config() {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) {
    throw new Error('WHATSAPP_TOKEN and WHATSAPP_PHONE_ID must be set before sending.');
  }
  // Overridable so tests can point at a local stand-in for Meta.
  const base = process.env.WHATSAPP_API_BASE ?? 'https://graph.facebook.com';
  return { token, phoneId, url: `${base}/${GRAPH_VERSION}/${phoneId}/messages` };
}

/** A plain text message. Only allowed inside the 24-hour customer window. */
export async function sendText(args: SendArgs & { body: string }): Promise<SendResult> {
  return send(args, {
    type: 'text',
    text: { preview_url: false, body: args.body },
  }, args.body, null);
}

/** A pre-approved template. The only thing allowed to open a conversation. */
export async function sendTemplate(
  args: SendArgs & {
    template: string;
    language?: string;
    /** Values for the template's {{1}}, {{2}} … placeholders. */
    variables?: string[];
  },
): Promise<SendResult> {
  const variables = args.variables ?? [];
  const components = variables.length
    ? [{ type: 'body', parameters: variables.map((text) => ({ type: 'text', text })) }]
    : undefined;

  return send(
    args,
    {
      type: 'template',
      template: {
        name: args.template,
        language: { code: args.language ?? 'en' },
        ...(components ? { components } : {}),
      },
    },
    `[template: ${args.template}] ${variables.join(' | ')}`.trim(),
    args.template,
  );
}

async function send(
  args: SendArgs,
  payload: Record<string, unknown>,
  bodyForLog: string,
  templateName: string | null,
): Promise<SendResult> {
  // Enforced here so it can never be skipped (golden rule, and Phase 8).
  if (args.lead.optedOut) {
    return { ok: false, reason: 'OPTED_OUT', error: 'lead has opted out of messages' };
  }

  // A retry with the same key must not send a second time.
  if (args.idempotencyKey) {
    const [already] = await db
      .select({ id: messages.id, waMessageId: messages.waMessageId })
      .from(messages)
      .where(eq(messages.waMessageId, args.idempotencyKey))
      .limit(1);
    if (already?.waMessageId) {
      return { ok: true, waMessageId: already.waMessageId, messageRowId: already.id };
    }
  }

  const { token, url } = config();

  let response: Response;
  let json: Record<string, unknown>;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: args.lead.phone,
        ...payload,
      }),
    });
    json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  } catch (error) {
    // Network trouble is temporary — let the task retry (golden rule 6).
    return {
      ok: false,
      reason: 'FAILED',
      error: error instanceof Error ? error.message : 'could not reach WhatsApp',
    };
  }

  if (!response.ok) {
    const err = (json.error ?? {}) as { message?: string; code?: number };
    const code = Number(err.code);
    const message = err.message ?? `WhatsApp returned ${response.status}`;

    if (UNDELIVERABLE_CODES.has(code)) {
      await markNotOnWhatsApp(args.lead.id, message);
      return { ok: false, reason: 'NOT_ON_WHATSAPP', error: message };
    }
    return { ok: false, reason: 'FAILED', error: `${message} (code ${code || response.status})` };
  }

  const waMessageId =
    ((json.messages as { id?: string }[] | undefined)?.[0]?.id ?? args.idempotencyKey) || null;

  const [row] = await db
    .insert(messages)
    .values({
      leadId: args.lead.id,
      direction: 'outbound',
      body: bodyForLog,
      templateName,
      waMessageId,
      status: 'sent',
    })
    .returning();

  await db.insert(touches).values({
    leadId: args.lead.id,
    channel: 'whatsapp',
    direction: 'outbound',
    outcome: 'sent',
    notes: templateName ? `template ${templateName}` : null,
  });

  await db
    .update(leads)
    .set({ lastContactAt: new Date(), updatedAt: new Date() })
    .where(eq(leads.id, args.lead.id));

  return { ok: true, waMessageId: waMessageId ?? row.id, messageRowId: row.id };
}

async function markNotOnWhatsApp(leadId: string, reason: string) {
  await db
    .update(leads)
    .set({ waState: 'NOT_ON_WHATSAPP', status: 'NOT_ON_WHATSAPP', updatedAt: new Date() })
    .where(eq(leads.id, leadId));

  await db.insert(touches).values({
    leadId,
    channel: 'whatsapp',
    direction: 'outbound',
    outcome: 'undeliverable',
    notes: reason.slice(0, 500),
  });
}
