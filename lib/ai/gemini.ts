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

/**
 * How long one request may take before we try another model.
 *
 * It was 30 seconds, tried on every key in turn. On a bad evening the
 * preferred model took 21–39 seconds per answer while a lite model answered in
 * one, so buyers waited up to a minute — and past the platform's 60-second
 * limit the reply was lost altogether. A healthy model answers well inside
 * this; one that does not is better abandoned than waited for.
 */
const PATIENCE_MS = 8_000;

/** Too little time left to be worth starting another request. */
const MIN_REQUEST_MS = 2_500;

/** Quota and rate-limit errors. These mean: try another key. */
const QUOTA_STATUS = new Set([429]);

/** How long a model that is overloaded or too slow is left alone. */
const BENCH_MS = 2 * 60_000;

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';

  /** Models that answered 400 to thinkingConfig. Learned once, reused after. */
  static readonly modelsWithoutThinking = new Set<string>();

  /**
   * Models that just told us they are overloaded, and when to believe in them
   * again.
   *
   * Without this, a model Google has taken offline is re-tried on every key for
   * every message, for as long as the outage lasts. Measured on a real evening:
   * the preferred model answered 503 on all three keys while a lite model
   * answered in under a second, so each buyer paid several seconds — sometimes
   * a 60-second worker timeout — for a model that was never going to reply.
   */
  private static readonly benched = new Map<string, number>();

  private static bench(model: string) {
    GeminiProvider.benched.set(model, Date.now() + BENCH_MS);
    console.warn(`[gemini] ${model} is unwell; resting it for ${BENCH_MS / 60_000} minutes`);
  }

  private static isBenched(model: string): boolean {
    const until = GeminiProvider.benched.get(model);
    if (until === undefined) return false;
    if (Date.now() >= until) {
      GeminiProvider.benched.delete(model);
      return false;
    }
    return true;
  }

  private configuredModels(): string[] {
    const configured = (process.env.GEMINI_MODELS ?? '')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
    return configured.length ? configured : DEFAULT_MODELS;
  }

  /**
   * Preferred order, but anything currently resting goes to the back rather
   * than being dropped — if every model is unwell we still try them all, and a
   * slow answer beats the canned fallback.
   */
  private models(): string[] {
    const all = this.configuredModels();
    const healthy = all.filter((m) => !GeminiProvider.isBenched(m));
    const resting = all.filter((m) => GeminiProvider.isBenched(m));
    return [...healthy, ...resting];
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
    const deadlineAt = opts.deadlineAt;

    /** Time this request may use: our patience, cut short by the caller's deadline. */
    const timeoutFor = (): number | null => {
      if (deadlineAt === undefined) return PATIENCE_MS;
      const left = deadlineAt - Date.now();
      return left < MIN_REQUEST_MS ? null : Math.min(PATIENCE_MS, left);
    };

    // Best healthy model first. For each, keys are tried only while the failure
    // is about the KEY (429, its own allowance). A 5xx or a timeout is about the
    // MODEL — it is overloaded for everyone — so the next key would only wait
    // for the same answer, and we move on to the next model instead.
    models: for (const model of this.models()) {
      for (const [index, key] of keys.entries()) {
        const label = keys.length > 1 ? `${model} (key ${index + 1})` : model;

        const timeoutMs = timeoutFor();
        if (timeoutMs === null) {
          lastError = `ran out of time (last: ${lastError})`;
          break models;
        }

        try {
          const call = (withThinking: boolean) =>
            fetch(`${base}/models/${model}:generateContent`, {
              method: 'POST',
              headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
              body: JSON.stringify(buildBody(withThinking)),
              // Without a deadline a stalled connection holds the worker open.
              // One was seen running for six minutes, blocking every other lead.
              signal: AbortSignal.timeout(timeoutMs),
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
            const retryMs = timeoutFor();
            if (retryMs === null) break models;
            res = await fetch(`${base}/models/${model}:generateContent`, {
              method: 'POST',
              headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
              body: JSON.stringify(buildBody(false)),
              signal: AbortSignal.timeout(retryMs),
            });
            data = (await res.json().catch(() => ({}))) as Record<string, never>;
          }

          if (!res.ok) {
            const error = (data as { error?: { message?: string; code?: number } }).error;
            lastError = `${label}: ${error?.message ?? `HTTP ${res.status}`}`;

            if (QUOTA_STATUS.has(res.status)) {
              // This key's allowance is spent; another key is another project.
              console.warn(`[gemini] ${label} out of allowance (429); trying the next key`);
              continue;
            }
            if (RETRYABLE_STATUS.has(res.status)) {
              // The model itself is overloaded — for every key alike.
              console.warn(`[gemini] ${label} unavailable (${res.status}); trying the next model`);
              GeminiProvider.bench(model);
              continue models;
            }
            if (res.status === 404) continue models; // this model does not exist
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
            continue models;
          }

          // A half-written sentence must never reach a buyer. Treat it as a
          // failure so the caller retries rather than sending it.
          if (candidate?.finishReason === 'MAX_TOKENS') {
            lastError = `${label}: reply was cut off at the token limit`;
            console.warn(`[gemini] ${lastError}`);
            continue models;
          }

          const usage = (data as {
            usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
          }).usageMetadata;

          // It answered, so it is well again.
          GeminiProvider.benched.delete(model);

          return {
            text,
            inputTokens: usage?.promptTokenCount ?? 0,
            outputTokens: usage?.candidatesTokenCount ?? 0,
            model: label,
          };
        } catch (error) {
          lastError = `${label}: ${describeNetworkError(error, timeoutMs)}`;
          if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
            // Too slow is a property of the model, not the key.
            GeminiProvider.bench(model);
            continue models;
          }
          // A dropped connection may be ours alone: try the next key.
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
function describeNetworkError(error: unknown, timeoutMs: number): string {
  if (!(error instanceof Error)) return String(error);

  if (error.name === 'TimeoutError' || error.name === 'AbortError') {
    return `gave up waiting after ${(timeoutMs / 1000).toFixed(1)}s`;
  }

  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as { code?: string }).code;
    return code ? `${error.message} (${code}: ${cause.message})` : `${error.message} (${cause.message})`;
  }

  return error.message;
}
