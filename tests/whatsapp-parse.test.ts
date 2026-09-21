import { describe, expect, it } from 'vitest';
import { parseWebhookPayload } from '@/lib/whatsapp/parse';

const wrap = (value: Record<string, unknown>) => ({
  entry: [{ changes: [{ value }] }],
});

describe('parseWebhookPayload', () => {
  it('reads an inbound text message', () => {
    const events = parseWebhookPayload(
      wrap({
        messages: [
          { id: 'wamid.1', from: '919876543210', type: 'text', timestamp: '1760000000',
            text: { body: 'Is it E-Khata?' } },
        ],
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'message',
      waMessageId: 'wamid.1',
      from: '919876543210',
      body: 'Is it E-Khata?',
      messageType: 'text',
    });
  });

  it('reads delivery statuses', () => {
    const events = parseWebhookPayload(
      wrap({ statuses: [{ id: 'wamid.2', status: 'read', recipient_id: '919876543210', timestamp: '1760000000' }] }),
    );
    expect(events[0]).toMatchObject({ kind: 'status', status: 'read', waMessageId: 'wamid.2' });
  });

  it('keeps a failure reason', () => {
    const events = parseWebhookPayload(
      wrap({
        statuses: [
          { id: 'wamid.3', status: 'failed', recipient_id: '91987', timestamp: '1760000000',
            errors: [{ title: 'Undeliverable', message: 'not on WhatsApp' }] },
        ],
      }),
    );
    expect(events[0]).toMatchObject({ status: 'failed', errorMessage: 'not on WhatsApp' });
  });

  it('describes non-text messages instead of losing them', () => {
    const events = parseWebhookPayload(
      wrap({ messages: [{ id: 'w1', from: '91987', type: 'image', timestamp: '1760000000' }] }),
    );
    expect(events[0]).toMatchObject({ body: '[image]', messageType: 'image' });
  });

  it('reads button and list replies', () => {
    const events = parseWebhookPayload(
      wrap({
        messages: [
          { id: 'w2', from: '91987', type: 'interactive', timestamp: '1760000000',
            interactive: { button_reply: { title: 'Book a visit' } } },
        ],
      }),
    );
    expect(events[0]).toMatchObject({ body: 'Book a visit' });
  });

  it('survives junk without throwing', () => {
    expect(parseWebhookPayload(null)).toEqual([]);
    expect(parseWebhookPayload({})).toEqual([]);
    expect(parseWebhookPayload({ entry: [] })).toEqual([]);
    expect(parseWebhookPayload(wrap({}))).toEqual([]);
    expect(parseWebhookPayload(wrap({ messages: [{ type: 'text' }] }))).toEqual([]);
    expect(parseWebhookPayload(wrap({ statuses: [{ id: 'x', status: 'invented' }] }))).toEqual([]);
  });

  it('reads several events from one delivery', () => {
    const events = parseWebhookPayload(
      wrap({
        messages: [{ id: 'm1', from: '91987', type: 'text', timestamp: '1760000000', text: { body: 'hi' } }],
        statuses: [{ id: 's1', status: 'delivered', recipient_id: '91987', timestamp: '1760000000' }],
      }),
    );
    expect(events).toHaveLength(2);
  });
});
