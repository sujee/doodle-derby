import { debugFetch } from '../debug';
import Anthropic from '@anthropic-ai/sdk';
import { thinkingMode } from '../settings';
import { sortModels, visionFromName, type ModelInfo } from './vision';
import { GuessError, promptFor, parseGuess, type Guesser, type GuessRequest, type GuessResult } from './types';

// Models that accept output_config.effort. Low effort keeps guesses fast.
export const EFFORT_MODELS = /^claude-(fable|mythos|opus|sonnet|haiku)-5/;
// Models that accept the server-side refusal fallback ("default" form, Claude API).
export const FALLBACK_MODELS = /^claude-(fable-5-1|opus-5-5|opus-5$|sonnet-5-5)/;

export class AnthropicGuesser implements Guesser {
  readonly label: string;
  private client: Anthropic;

  constructor(
    apiKey: string,
    private model: string,
  ) {
    this.label = model;
    // The key is the player's own and stays in this tab; it is sent only to api.anthropic.com.
    // debugFetch logs the raw request/response when debug logging is on.
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0, fetch: debugFetch });
  }

  async guess({ image, wrongGuesses, signal }: GuessRequest): Promise<GuessResult> {
    const data = image.slice(image.indexOf(',') + 1);
    const useFallback = FALLBACK_MODELS.test(this.model);
    // Thinking off: ask for low effort, where the model takes it. Default: send nothing.
    const lowEffort = thinkingMode() === 'off' && EFFORT_MODELS.test(this.model);
    try {
      const response = await this.client.beta.messages.create(
        {
          model: this.model,
          max_tokens: 2000,
          ...(lowEffort ? { output_config: { effort: 'low' as const } } : {}),
          ...(useFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
                { type: 'text', text: promptFor(wrongGuesses) },
              ],
            },
          ],
        },
        { signal },
      );
      if (response.stop_reason === 'refusal') throw new GuessError('other', 'Model declined');
      const text = response.content.find((b) => b.type === 'text');
      if (!text || text.type !== 'text' || !text.text.trim()) throw new GuessError('other', 'Empty response');
      // output_tokens includes thinking tokens, which are billed as output.
      const usage = { input: response.usage.input_tokens, output: response.usage.output_tokens };
      return { ...parseGuess(text.text), usage };
    } catch (e) {
      throw toGuessError(e);
    }
  }
}

export async function listAnthropicModels(apiKey: string): Promise<ModelInfo[]> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0, fetch: debugFetch });
  try {
    const models: ModelInfo[] = [];
    for await (const m of client.models.list()) {
      const img = m.capabilities?.image_input?.supported;
      models.push({ id: m.id, vision: img === undefined ? visionFromName(m.id) : img ? 'yes' : 'no' });
    }
    return sortModels(models);
  } catch (e) {
    throw toGuessError(e);
  }
}

export function toGuessError(e: unknown): unknown {
  if (e instanceof GuessError) return e;
  if (e instanceof Anthropic.APIUserAbortError) return new DOMException('Aborted', 'AbortError');
  if (e instanceof Anthropic.RateLimitError) {
    return new GuessError('rate_limit', 'Rate limited', Number(e.headers?.get('retry-after')) || undefined);
  }
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new GuessError('auth', 'Invalid API key or no access');
  }
  if (e instanceof Anthropic.BadRequestError || e instanceof Anthropic.NotFoundError) {
    return new GuessError('bad_request', e.message);
  }
  if (e instanceof Anthropic.APIConnectionError) return new GuessError('network', 'Could not reach Anthropic');
  if (e instanceof Anthropic.APIError) return new GuessError('other', e.message);
  return e;
}
