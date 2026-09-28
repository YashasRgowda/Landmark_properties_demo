/**
 * Which pre-approved WhatsApp template to use, and with what values.
 *
 * Meta only lets a business write freely within 24 hours of the buyer's last
 * message. Outside that — the first message to a new lead, a follow-up days
 * later, a visit reminder — only a template Meta has approved may be sent.
 *
 * The names are configuration because approval happens in Meta, not here. The
 * default everywhere is `hello_world`, which exists on every test number and
 * takes no values, so the whole flow runs today; point these at Landmark's own
 * templates once Meta approves them.
 */

export type TemplateKind = 'first' | 'followup' | 'reminder';

const ENV: Record<TemplateKind, { name: string; lang: string }> = {
  first: { name: 'WHATSAPP_FIRST_TEMPLATE', lang: 'WHATSAPP_FIRST_TEMPLATE_LANG' },
  followup: { name: 'WHATSAPP_FOLLOWUP_TEMPLATE', lang: 'WHATSAPP_FOLLOWUP_TEMPLATE_LANG' },
  reminder: { name: 'WHATSAPP_REMINDER_TEMPLATE', lang: 'WHATSAPP_REMINDER_TEMPLATE_LANG' },
};

export type TemplateChoice = { template: string; language: string; variables: string[] };

/**
 * `extra` fills placeholders after the name — a reminder template approved as
 * "Hi {{1}}, your visit is on {{2}}" gets the time as {{2}}. `hello_world` has
 * no placeholders, so it is always sent with none.
 */
export function templateFor(kind: TemplateKind, name: string | null, extra: string[] = []): TemplateChoice {
  const template = process.env[ENV[kind].name]?.trim() || 'hello_world';
  const language = process.env[ENV[kind].lang]?.trim() || 'en_US';
  const first = (name ?? '').trim().split(/\s+/)[0] || 'there';
  return {
    template,
    language,
    variables: template === 'hello_world' ? [] : [first, ...extra],
  };
}
