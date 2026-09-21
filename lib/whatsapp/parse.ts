/**
 * Meta's webhook payload, turned into plain events.
 *
 * Pure on purpose — no database, no server-only import — so the parsing can be
 * unit-tested on its own.
 */

export type InboundMessageEvent = {
  kind: 'message';
  waMessageId: string;
  from: string;
  body: string;
  timestamp: Date;
  messageType: string;
};

export type StatusEvent = {
  kind: 'status';
  waMessageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  recipient: string;
  timestamp: Date;
  errorMessage: string | null;
};

export type WhatsAppEvent = InboundMessageEvent | StatusEvent;

/**
 * Pull the events out of a webhook payload. Unknown shapes are skipped rather
 * than throwing — Meta adds new event types without warning, and an unknown one
 * must never stall the queue.
 */
export function parseWebhookPayload(payload: unknown): WhatsAppEvent[] {
  const events: WhatsAppEvent[] = [];
  const body = payload as {
    entry?: { changes?: { value?: Record<string, unknown> }[] }[];
  };

  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value ?? {};

      for (const raw of (value.messages as Record<string, unknown>[] | undefined) ?? []) {
        const id = typeof raw.id === 'string' ? raw.id : null;
        const from = typeof raw.from === 'string' ? raw.from : null;
        if (!id || !from) continue;

        const type = typeof raw.type === 'string' ? raw.type : 'unknown';
        events.push({
          kind: 'message',
          waMessageId: id,
          from,
          body: extractBody(raw, type),
          timestamp: toDate(raw.timestamp),
          messageType: type,
        });
      }

      for (const raw of (value.statuses as Record<string, unknown>[] | undefined) ?? []) {
        const id = typeof raw.id === 'string' ? raw.id : null;
        const status = typeof raw.status === 'string' ? raw.status : null;
        if (!id || !status) continue;
        if (!['sent', 'delivered', 'read', 'failed'].includes(status)) continue;

        const errors = (raw.errors as { title?: string; message?: string }[] | undefined) ?? [];
        events.push({
          kind: 'status',
          waMessageId: id,
          status: status as StatusEvent['status'],
          recipient: typeof raw.recipient_id === 'string' ? raw.recipient_id : '',
          timestamp: toDate(raw.timestamp),
          errorMessage: errors[0]?.message ?? errors[0]?.title ?? null,
        });
      }
    }
  }

  return events;
}

function extractBody(raw: Record<string, unknown>, type: string): string {
  if (type === 'text') {
    const text = raw.text as { body?: string } | undefined;
    return text?.body ?? '';
  }
  if (type === 'button') {
    const button = raw.button as { text?: string } | undefined;
    return button?.text ?? '[button]';
  }
  if (type === 'interactive') {
    const i = raw.interactive as
      | { button_reply?: { title?: string }; list_reply?: { title?: string } }
      | undefined;
    return i?.button_reply?.title ?? i?.list_reply?.title ?? '[interactive]';
  }
  return `[${type}]`;
}

function toDate(value: unknown): Date {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return new Date(seconds * 1000);
  return new Date();
}

