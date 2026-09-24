import {
  RetryableAIError,
  type AIProvider,
  type CompleteOptions,
  type CompleteResult,
} from './provider';

const DEFAULT_MODELS = [
  'gemini-3.5-flash',
  'gemini-flash-latest',
  'gemini-3.5-flash-lite',
  'gemini-flash-lite-latest',
];

/** Google's free tier throttles hard, so a busy model falls through to the next. */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/** A single generation may not take longer than this. */
const REQUEST_TIMEOUT_MS = 30_000;

/** Quota and rate-limit errors. These mean: try another key. */
const QUOTA_STATUS = new Set([429]);

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';

  /** Models that answered 400 to thinkingConfig. Learned once, reused after. */
  static readonly modelsWithoutThinking = new Set<string>();

  private models(): string[] {
    const configured = (process.env.GEMINI_MODELS ?? '')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
    return configured.length ? configured : DEFAULT_MODELS;
  }

  /**
   * Every API key available, in order.
   *
   * Google's free tier is per-project, so a second key is a second allowance.
   * Set GEMINI_API_KEYS to a comma-separated list; GEMINI_API_KEY still works
   * on its own.
   */
  private keys(): string[] {
    const many = (process.env.GEMINI_API_KEYS ?? '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    const single = (process.env.GEMINI_API_KEY ?? '').trim();
    const all = many.length ? many : single ? [single] : [];
    if (all.length === 0) throw new Error('No Gemini key set — fill GEMINI_API_KEY or GEMINI_API_KEYS.');
    return all;
  }

  async complete(opts: CompleteOptions): Promise<CompleteResult> {
    const base =
      process.env.GEMINI_API_BASE?.trim() || 'https://generativelanguage.googleapis.com/v1beta';

    /**
     * Gemini 3.x thinks before answering, and those thoughts are charged
     * against maxOutputTokens. Left on, it spent ~574 of a 600 budget thinking
     * and returned a reply chopped off mid-sentence — and a Reader JSON too
     * short to parse, which silently froze every lead at COLD.
     *
     * The "lite" models do not think and reject the setting outright with a
     * 400, so it is offered and then dropped for any model that refuses it.
     */
    const buildBody = (withThinking: boolean) => ({
      system_instruction: { parts: [{ text: opts.system }] },
      contents: opts.messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: {
        maxOutputTokens: opts.maxTokens ?? 2000,
        temperature: opts.temperature ?? 0.7,
        ...(withThinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        ...(opts.json ? { responseMimeType: 'application/json' } : {}),
      },
    });

    /** Models known to reject thinkingConfig, remembered for the process. */
    const noThinking = GeminiProvider.modelsWithoutThinking;

    const keys = this.keys();
    let lastError = 'no model was tried';

    // Best model first, and for each one every key — a key that is out of
    // allowance must not cost us the better model.
    for (const model of this.models()) {
      for (const [index, key] of keys.entries()) {
        const label = keys.length > 1 ? `${model} (key ${index + 1})` : model;

        try {
          const call = (withThinking: boolean) =>
            fetch(`${base}/models/${model}:generateContent`, {
              method: 'POST',
              headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
              body: JSON.stringify(buildBody(withThinking)),
              // Without a deadline a stalled connection holds the worker open.
              // One was seen running for six minutes, blocking every other lead.
              signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });

          let res = await call(!noThinking.has(model));
          let data = (await res.json().catch(() => ({}))) as Record<string, never>;

          // This model does not accept the thinking setting. Remember that and
          // ask again without it, rather than losing the model entirely.
          if (
            res.status === 400 &&
            !noThinking.has(model) &&
            /invalid argument|thinking/i.test(
              (data as { error?: { message?: string } }).error?.message ?? '',
            )
          ) {
            noThinking.add(model);
            res = await call(false);
            data = (await res.json().catch(() => ({}))) as Record<string, never>;
          }

          if (!res.ok) {
            const error = (data as { error?: { message?: string; code?: number } }).error;
            lastError = `${label}: ${error?.message ?? `HTTP ${res.status}`}`;

            // Out of allowance, or the model is momentarily busy: another key
            // is a different project and may well get through, so never give up
            // on the better model until every key has been tried.
            if (QUOTA_STATUS.has(res.status) || RETRYABLE_STATUS.has(res.status)) {
              console.warn(`[gemini] ${label} unavailable (${res.status}); trying the next key`);
              continue;
            }
            if (res.status === 404) break; // this model does not exist
            throw new Error(`Gemini: ${lastError}`);
          }

          const candidate = (data as {
            candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
          }).candidates?.[0];

          const text = (candidate?.content?.parts ?? [])
            .map((p) => p.text ?? '')
            .join('')
            .trim();

          if (!text) {
            lastError = `${label}: empty reply (${candidate?.finishReason ?? 'unknown'})`;
            continue;
          }

          // A half-written sentence must never reach a buyer. Treat it as a
          // failure so the caller retries rather than sending it.
          if (candidate?.finishReason === 'MAX_TOKENS') {
            lastError = `${label}: reply was cut off at the token limit`;
            console.warn(`[gemini] ${lastError}`);
            continue;
          }

          const usage = (data as {
            usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
          }).usageMetadata;

          return {
            text,
            inputTokens: usage?.promptTokenCount ?? 0,
            outputTokens: usage?.candidatesTokenCount ?? 0,
            model: label,
          };
        } catch (error) {
          lastError = `${label}: ${describeNetworkError(error)}`;
          // Network trouble: try the next key, then the next model.
        }
      }
    }

    throw new RetryableAIError(`every Gemini model and key failed — last error: ${lastError}`);
  }
}

/**
 * Say what actually went wrong.
 *
 * Node reports every transport failure as the word "fetch failed" and hides the
 * real reason on `error.cause`, so a DNS outage, a reset socket, an expired
 * certificate and a timeout all read identically in the logs — which is useless
 * at 11pm when the buyer is waiting and nothing is replying.
 */
function describeNetworkError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  if (error.name === 'TimeoutError' || error.name === 'AbortError') {
    return `gave up waiting after ${REQUEST_TIMEOUT_MS / 1000}s`;
  }

  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as { code?: string }).code;
    return code ? `${error.message} (${code}: ${cause.message})` : `${error.message} (${cause.message})`;
  }

  return error.message;
}
