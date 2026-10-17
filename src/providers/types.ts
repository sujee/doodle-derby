export type GuessRequest = {
  /** JPEG data URL of the current drawing. */
  image: string;
  /** This guesser's wrong guesses so far this round. */
  wrongGuesses: string[];
  signal: AbortSignal;
};

/** A guess plus how sure the model is (0–100), or null if it didn't say. Confidence is display-only. */
export type TokenUsage = { input: number; output: number };
export type GuessResult = {
  guess: string;
  confidence: number | null;
  /** Tokens billed for this call, when the provider reports them. */
  usage?: TokenUsage;
};

export interface Guesser {
  readonly label: string;
  guess(req: GuessRequest): Promise<GuessResult>;
}

export type ProviderKind = 'fake' | 'openai' | 'anthropic';

export type GuesserConfig =
  | { kind: 'fake' }
  | { kind: 'openai'; baseUrl: string; apiKey: string; model: string }
  | { kind: 'anthropic'; apiKey: string; model: string };

export type GuessErrorKind = 'rate_limit' | 'auth' | 'network' | 'bad_request' | 'other';

export class GuessError extends Error {
  constructor(
    readonly kind: GuessErrorKind,
    message: string,
    /** Seconds to wait before retrying, when the provider said so. */
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

export const PROMPT =
  'We are playing Pictionary. Look at this hand-drawn sketch (it may be unfinished) and guess the single object it shows. ' +
  'Reply with only the object name in 1-3 words, lowercase, then " | " and how confident you are from 0 to 100. ' +
  'Example: cat | 70. No other text.';

export function promptFor(wrongGuesses: string[]): string {
  return wrongGuesses.length
    ? `${PROMPT} These guesses were already wrong, so do not repeat them: ${wrongGuesses.join(', ')}.`
    : PROMPT;
}

/** Split "<object> | <confidence>" into a cleaned guess and a 0–100 confidence (null if missing or unparseable). */
export function parseGuess(text: string): GuessResult {
  const line = text.trim().split('\n')[0];
  const bar = line.lastIndexOf('|');
  if (bar < 0) return { guess: cleanGuess(line), confidence: null };
  const n = Number.parseFloat(line.slice(bar + 1).replace(/%/g, ''));
  return {
    guess: cleanGuess(line.slice(0, bar)),
    confidence: Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : null,
  };
}

/** Keep only the first line, without quotes or a trailing period. */
export function cleanGuess(text: string): string {
  // Trim the line itself too: trailing spaces would stop the quote/period stripping.
  return text.trim().split('\n')[0].trim().replace(/^["'`*]+|["'`*.!]+$/g, '').trim().slice(0, 60);
}

export function errorFromStatus(status: number, message: string, retryAfter?: string | null): GuessError {
  if (status === 429) return new GuessError('rate_limit', 'Rate limited', Number(retryAfter) || undefined);
  if (status === 401 || status === 403) return new GuessError('auth', 'Invalid API key or no access');
  if (status === 400 || status === 404 || status === 422) return new GuessError('bad_request', message || `HTTP ${status}`);
  return new GuessError('other', message || `HTTP ${status}`);
}
