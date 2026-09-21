import {
  RetryableAIError,
  type AIProvider,
  type CompleteOptions,
  type CompleteResult,
} from './provider';

/** A single generation may not take longer than this. */
const REQUEST_TIMEOUT_MS = 30_000;

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 529]);

/** Used for the pilot. Swapped in by setting AI_PROVIDER=claude. */
export class ClaudeProvider implements AIProvider {
  readonly name = 'claude';

  async complete(opts: CompleteOptions): Promise<CompleteResult> {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY is not set.');

    const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';
    const base = process.env.ANTHROPIC_API_BASE ?? 'https://api.anthropic.com';

    // Claude has no JSON mode; the instruction plus a prefilled "{" does it.
    const system = opts.json
      ? `${opts.system}\n\nReply with a single valid JSON object and nothing else.`
      : opts.system;

    const messages = opts.messages.map((m) => ({ role: m.role, content: m.content }));
    if (opts.json) messages.push({ role: 'assistant', content: '{' });

    const res = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens ?? 800,
        temperature: opts.temperature ?? 0.7,
        system,
        messages,
      }),
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, never>;

    if (!res.ok) {
      const message =
        (data as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`;
      if (RETRYABLE_STATUS.has(res.status)) throw new RetryableAIError(`Claude: ${message}`);
      throw new Error(`Claude: ${message}`);
    }

    const blocks = (data as { content?: { type?: string; text?: string }[] }).content ?? [];
    let text = blocks
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
      .trim();

    // Put back the "{" we prefilled.
    if (opts.json && text && !text.startsWith('{')) text = `{${text}`;

    const usage = (data as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;

    return {
      text,
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      model,
    };
  }
}
