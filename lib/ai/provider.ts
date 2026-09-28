/**
 * One interface for every AI job, so the model can be swapped in one place.
 * Pure types — no server imports — so prompts and parsing stay testable.
 */
export type AIMessage = { role: 'user' | 'assistant'; content: string };

export type CompleteOptions = {
  system: string;
  messages: AIMessage[];
  /** Ask for strict JSON back. Used by The Reader. */
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  /**
   * Epoch milliseconds by which the answer must be back, whatever happens.
   * The provider stops trying models once too little time is left, so the
   * caller always has time to fall back. Without it, a slow AI outran the
   * hosting platform's limit and the buyer got nothing — not even the fallback.
   */
  deadlineAt?: number;
};

export type CompleteResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** Which model actually answered — the first choice may have been busy. */
  model: string;
};

export interface AIProvider {
  readonly name: string;
  complete(opts: CompleteOptions): Promise<CompleteResult>;
}

/** Errors worth trying the next model for. */
export class RetryableAIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableAIError';
  }
}
