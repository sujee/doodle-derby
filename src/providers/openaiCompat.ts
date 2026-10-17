import { debugFetch } from '../debug';
import { sortModels, visionFromMetadata, type ModelInfo } from './vision';
import { errorFromStatus, GuessError, promptFor, parseGuess, type Guesser, type GuessRequest, type GuessResult } from './types';

/** Any endpoint that speaks the OpenAI chat-completions API. */
export class OpenAICompatGuesser implements Guesser {
  readonly label: string;

  constructor(
    private baseUrl: string,
    private apiKey: string,
    private model: string,
  ) {
    this.label = model;
  }

  async guess({ image, wrongGuesses, signal }: GuessRequest): Promise<GuessResult> {
    const body = {
      model: this.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: promptFor(wrongGuesses) },
            { type: 'image_url', image_url: { url: image } },
          ],
        },
      ],
    };
    const res = await request(`${trimSlash(this.baseUrl)}/chat/completions`, this.apiKey, signal, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new GuessError('other', 'Empty response');
    const u = data?.usage;
    const usage =
      typeof u?.prompt_tokens === 'number' ? { input: u.prompt_tokens, output: u.completion_tokens ?? 0 } : undefined;
    return { ...parseGuess(text), usage };
  }
}

export async function listOpenAIModels(baseUrl: string, apiKey: string): Promise<ModelInfo[]> {
  // verbose=true makes some providers (e.g. Nebius) include modalities; fall back if it's rejected.
  const url = `${trimSlash(baseUrl)}/models`;
  let res: Response;
  try {
    res = await request(`${url}?verbose=true`, apiKey, AbortSignal.timeout(15000));
  } catch (e) {
    if (!(e instanceof GuessError) || e.kind !== 'bad_request') throw e;
    res = await request(url, apiKey, AbortSignal.timeout(15000));
  }
  const data = await res.json();
  // Most return { data: [...] }; Together returns a bare array.
  const raw: Record<string, any>[] = Array.isArray(data) ? data : (data?.data ?? []);
  let models = raw.filter((m) => m?.id).map((m) => ({ id: String(m.id), vision: visionFromMetadata(m) }));
  if (isOllama(baseUrl)) models = await withOllamaCapabilities(baseUrl, apiKey, models);
  return sortModels(models);
}

function isOllama(baseUrl: string) {
  return /:11434\b|ollama\.com/.test(baseUrl);
}

/** Ollama's OpenAI-style /models has no capabilities, but its native /api/show lists "vision". */
async function withOllamaCapabilities(baseUrl: string, apiKey: string, models: ModelInfo[]): Promise<ModelInfo[]> {
  const root = trimSlash(baseUrl).replace(/\/v1$/, '');
  return Promise.all(
    models.map(async (m) => {
      try {
        const res = await request(`${root}/api/show`, apiKey, AbortSignal.timeout(10000), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: m.id }),
        });
        const caps = (await res.json())?.capabilities;
        if (Array.isArray(caps)) return { id: m.id, vision: caps.includes('vision') ? 'yes' : 'no' } as ModelInfo;
      } catch {
        /* keep the name-based guess */
      }
      return m;
    }),
  );
}

export async function request(url: string, apiKey: string, signal: AbortSignal, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    // debugFetch is fetch, plus a request/response report in the console when debug logging is on.
    res = await debugFetch(url, {
      ...init,
      signal,
      headers: { ...(init.headers ?? {}), ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError' || (e as Error).name === 'TimeoutError') throw e;
    throw new GuessError('network', 'Could not reach endpoint (offline, wrong URL, or it blocks browser requests)');
  }
  if (!res.ok) {
    let message = '';
    try {
      const err = await res.json();
      message = err?.error?.message ?? err?.message ?? '';
    } catch {
      /* not JSON */
    }
    throw errorFromStatus(res.status, message, res.headers.get('retry-after'));
  }
  return res;
}

export function trimSlash(s: string) {
  return s.trim().replace(/\/+$/, '');
}
