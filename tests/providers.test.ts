import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDoodler } from '../src/doodler';
import { AnthropicGuesser, listAnthropicModels } from '../src/providers/anthropic';
import { listOpenAIModels, OpenAICompatGuesser } from '../src/providers/openaiCompat';
import { providerName } from '../src/providers';
import { GuessError } from '../src/providers/types';

const IMAGE = 'data:image/jpeg;base64,QUJDREVGRw==';

type Call = { url: string; method: string; headers: Record<string, string>; body: any };

/** Stub fetch: records each request and answers with the handler's response. */
function mockFetch(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    const call = { url, method: (init.method ?? 'GET').toUpperCase(), headers, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined };
    calls.push(call);
    return handler(call);
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const signal = () => new AbortController().signal;

afterEach(() => vi.unstubAllGlobals());

describe('OpenAI-compatible guesser', () => {
  const reply = (content: string, usage = { prompt_tokens: 812, completion_tokens: 4 }) =>
    json({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage });

  it('sends the prompt and the snapshot as an image_url data URL, with the key as a bearer token', async () => {
    const calls = mockFetch(() => reply('cat | 72'));
    const g = new OpenAICompatGuesser('https://api.example.com/v1/', 'sk-secret', 'vision-model');
    const r = await g.guess({ image: IMAGE, wrongGuesses: ['dog'], signal: signal() });
    expect(r).toEqual({ guess: 'cat', confidence: 72, usage: { input: 812, output: 4 } });
    const [call] = calls;
    expect(call.url).toBe('https://api.example.com/v1/chat/completions'); // trailing slash trimmed
    expect(call.method).toBe('POST');
    expect(call.headers.authorization).toBe('Bearer sk-secret');
    expect(call.body.model).toBe('vision-model');
    const [text, image] = call.body.messages[0].content;
    expect(text).toMatchObject({ type: 'text' });
    expect(text.text).toMatch(/already wrong.*dog/);
    expect(image).toEqual({ type: 'image_url', image_url: { url: IMAGE } });
  });

  describe('asks for no thinking', () => {
    const ask = (g: OpenAICompatGuesser) => g.guess({ image: IMAGE, wrongGuesses: [], signal: signal() });

    it('other hosts get the chat template flags', async () => {
      const calls = mockFetch(() => reply('cat | 72'));
      await ask(new OpenAICompatGuesser('https://api.tokenfactory.nebius.com/v1', 'k', 'Qwen/Qwen3-VL'));
      expect(calls[0].body.chat_template_kwargs).toEqual({ enable_thinking: false, thinking: false });
      expect(calls[0].body.reasoning_effort).toBe('low'); // for models that ignore the template flags (GLM)
    });

    it('Ollama gets think: false', async () => {
      const calls = mockFetch(() => reply('cat | 72'));
      await ask(new OpenAICompatGuesser('http://localhost:11434/v1', '', 'qwen3-vl'));
      expect(calls[0].body).toMatchObject({ think: false, reasoning_effort: 'none' });
    });

    it('OpenAI: a 400 moves on to the next setting, and the one that worked is kept', async () => {
      const calls = mockFetch((c) =>
        c.body.reasoning_effort === 'none' ? json({ error: { message: "Unsupported value: 'none'" } }, 400) : reply('cat | 72'),
      );
      const g = new OpenAICompatGuesser('https://api.openai.com/v1', 'k', 'gpt-5');
      await expect(ask(g)).resolves.toMatchObject({ guess: 'cat' });
      await ask(g);
      expect(calls.map((c) => c.body.reasoning_effort)).toEqual(['none', 'minimal', 'minimal']);
    });

    it('a model that takes no setting gets a plain request; a real 400 still surfaces', async () => {
      const plain = mockFetch((c) => ('reasoning_effort' in c.body ? json({ error: { message: 'Unsupported parameter' } }, 400) : reply('cat | 72')));
      await ask(new OpenAICompatGuesser('https://api.openai.com/v1', 'k', 'gpt-4o'));
      expect(plain).toHaveLength(3);
      expect(plain[2].body).not.toHaveProperty('reasoning_effort');

      const failing = mockFetch(() => json({ error: { message: 'model does not support images' } }, 400));
      await expect(ask(new OpenAICompatGuesser('https://x.test/v1', 'k', 'm'))).rejects.toThrow('model does not support images');
      expect(failing).toHaveLength(3); // each setting, then none
    });
  });

  it('sends no Authorization header when there is no key (local Ollama)', async () => {
    const calls = mockFetch(() => reply('sun | 50'));
    await new OpenAICompatGuesser('http://localhost:11434/v1', '', 'gemma3').guess({ image: IMAGE, wrongGuesses: [], signal: signal() });
    expect(calls[0].headers.authorization).toBeUndefined();
  });

  it.each([
    [() => json({ error: { message: 'bad key' } }, 401), 'auth'],
    [() => json({}, 429, { 'retry-after': '7' }), 'rate_limit'],
    [() => json({ error: { message: 'model does not support images' } }, 400), 'bad_request'],
    [() => json({ error: { message: 'boom' } }, 500), 'other'],
    [() => reply(''), 'other'],
  ])('maps failures to GuessError kinds (%#)', async (respond, kind) => {
    mockFetch(respond);
    const p = new OpenAICompatGuesser('https://api.example.com/v1', 'k', 'm').guess({ image: IMAGE, wrongGuesses: [], signal: signal() });
    await expect(p).rejects.toBeInstanceOf(GuessError);
    await expect(p).rejects.toMatchObject({ kind });
  });

  it('keeps the provider’s error message and the retry-after time', async () => {
    mockFetch(() => json({ error: { message: 'model does not support images' } }, 400));
    await expect(new OpenAICompatGuesser('https://x.test/v1', 'k', 'm').guess({ image: IMAGE, wrongGuesses: [], signal: signal() })).rejects.toThrow(
      'model does not support images',
    );
    mockFetch(() => json({}, 429, { 'retry-after': '7' }));
    await expect(new OpenAICompatGuesser('https://x.test/v1', 'k', 'm').guess({ image: IMAGE, wrongGuesses: [], signal: signal() })).rejects.toMatchObject({
      retryAfter: 7,
    });
  });

  it('a network failure (offline, CORS, wrong URL) is a "network" error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(new OpenAICompatGuesser('https://x.test/v1', 'k', 'm').guess({ image: IMAGE, wrongGuesses: [], signal: signal() })).rejects.toMatchObject({
      kind: 'network',
    });
  });
});

describe('OpenAI-compatible model list', () => {
  it('asks for the verbose list and reads image support from it', async () => {
    const calls = mockFetch(() =>
      json({ data: [{ id: 'b-text', architecture: { modality: 'text->text' } }, { id: 'a-vision', architecture: { modality: 'text+image->text' } }] }),
    );
    const models = await listOpenAIModels('https://api.example.com/v1', 'k');
    expect(calls[0].url).toBe('https://api.example.com/v1/models?verbose=true');
    expect(models).toEqual([
      { id: 'a-vision', vision: 'yes' },
      { id: 'b-text', vision: 'no' },
    ]);
  });

  it('falls back to the plain list when the provider rejects verbose=true, and reads bare arrays', async () => {
    const calls = mockFetch((c) => (c.url.includes('verbose') ? json({ error: { message: 'unknown param' } }, 400) : json([{ id: 'gpt-4o' }])));
    const models = await listOpenAIModels('https://api.together.xyz/v1', 'k');
    expect(calls.map((c) => c.url)).toEqual(['https://api.together.xyz/v1/models?verbose=true', 'https://api.together.xyz/v1/models']);
    expect(models).toEqual([{ id: 'gpt-4o', vision: 'likely' }]);
  });

  it('asks Ollama which models have the "vision" capability', async () => {
    const calls = mockFetch((c) => {
      if (c.url.endsWith('/api/show')) return json({ capabilities: c.body.model === 'llava' ? ['completion', 'vision'] : ['completion'] });
      return json({ data: [{ id: 'llava' }, { id: 'qwen3' }] });
    });
    const models = await listOpenAIModels('http://localhost:11434/v1', '');
    expect(calls.filter((c) => c.url === 'http://localhost:11434/api/show').map((c) => c.body.model).sort()).toEqual(['llava', 'qwen3']);
    expect(models).toEqual([
      { id: 'llava', vision: 'yes' },
      { id: 'qwen3', vision: 'no' },
    ]);
  });
});

describe('Anthropic guesser', () => {
  const message = (text: string, extra: Record<string, unknown> = {}) =>
    json({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5-5',
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 412, output_tokens: 38 },
      ...extra,
    });

  it('sends the snapshot as a base64 image block with the right headers and settings', async () => {
    const calls = mockFetch(() => message('circle | 85'));
    const r = await new AnthropicGuesser('sk-ant-secret', 'claude-sonnet-5-5').guess({ image: IMAGE, wrongGuesses: [], signal: signal() });
    expect(r).toEqual({ guess: 'circle', confidence: 85, usage: { input: 412, output: 38 } });
    const [call] = calls;
    expect(call.url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/messages/);
    expect(call.headers['x-api-key']).toBe('sk-ant-secret');
    expect(call.headers['anthropic-version']).toBeTruthy();
    expect(call.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(call.headers['anthropic-beta']).toMatch(/server-side-fallback/);
    expect(call.body).toMatchObject({ model: 'claude-sonnet-5-5', output_config: { effort: 'low' }, fallbacks: 'default' });
    const [image, text] = call.body.messages[0].content;
    expect(image).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJDREVGRw==' } });
    expect(text.type).toBe('text');
  });

  it('older models get no effort setting and no fallback', async () => {
    const calls = mockFetch(() => message('cat | 50'));
    await new AnthropicGuesser('k', 'claude-haiku-4-5').guess({ image: IMAGE, wrongGuesses: [], signal: signal() });
    expect(calls[0].body.output_config).toBeUndefined();
    expect(calls[0].body.fallbacks).toBeUndefined();
    expect(calls[0].headers['anthropic-beta']).toBeUndefined();
  });

  it('a refusal or an empty reply is an error', async () => {
    mockFetch(() => message('', { stop_reason: 'refusal', content: [] }));
    await expect(new AnthropicGuesser('k', 'claude-sonnet-5-5').guess({ image: IMAGE, wrongGuesses: [], signal: signal() })).rejects.toThrow('declined');
    mockFetch(() => message('   '));
    await expect(new AnthropicGuesser('k', 'claude-sonnet-5-5').guess({ image: IMAGE, wrongGuesses: [], signal: signal() })).rejects.toThrow('Empty');
  });

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limit'],
    [400, 'bad_request'],
    [404, 'bad_request'],
  ])('HTTP %i → %s', async (status, kind) => {
    mockFetch(() => json({ type: 'error', error: { type: 'x', message: 'nope' } }, status));
    await expect(new AnthropicGuesser('k', 'claude-sonnet-5-5').guess({ image: IMAGE, wrongGuesses: [], signal: signal() })).rejects.toMatchObject({ kind });
  });

  it('lists models with image support from their capabilities', async () => {
    mockFetch(() =>
      json({
        data: [
          { id: 'claude-x', type: 'model', display_name: 'X', created_at: '2026-01-01T00:00:00Z', capabilities: { image_input: { supported: false } } },
          { id: 'claude-sonnet-5-5', type: 'model', display_name: 'S', created_at: '2026-01-01T00:00:00Z', capabilities: { image_input: { supported: true } } },
        ],
        has_more: false,
        first_id: 'claude-x',
        last_id: 'claude-sonnet-5-5',
      }),
    );
    expect(await listAnthropicModels('k')).toEqual([
      { id: 'claude-sonnet-5-5', vision: 'yes' },
      { id: 'claude-x', vision: 'no' },
    ]);
  });
});

describe('doodlers that call models', () => {
  const strokes = '{"strokes": [[[10,10],[200,200]], [[50,50],[60,60]]]}';

  it('Anthropic asks for structured JSON strokes, and retries without the schema if the model refuses it', async () => {
    let first = true;
    const calls = mockFetch(() => {
      if (first) {
        first = false;
        return json({ type: 'error', error: { type: 'invalid_request_error', message: 'output_config.format not supported' } }, 400);
      }
      return json({
        id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-4-5', stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: strokes }], usage: { input_tokens: 90, output_tokens: 700 },
      });
    });
    const d = await createDoodler({ kind: 'anthropic', apiKey: 'k', model: 'claude-haiku-4-5' }).draw('sun', signal());
    expect(d.strokes).toHaveLength(2);
    expect(d.usage).toEqual({ input: 90, output: 700 });
    expect(calls[0].body.output_config.format.type).toBe('json_schema');
    expect(calls[1].body.output_config).toBeUndefined();
    expect(calls[0].body.messages[0].content).toMatch(/doodler.*"sun"/s);
  });

  it('OpenAI-compatible reads strokes out of a chatty reply', async () => {
    mockFetch(() => json({ choices: [{ message: { content: `Here you go:\n\`\`\`json\n${strokes}\n\`\`\`` } }], usage: { prompt_tokens: 80, completion_tokens: 600 } }));
    const d = await createDoodler({ kind: 'openai', baseUrl: 'https://x.test/v1', apiKey: 'k', model: 'm' }).draw('sun', signal());
    expect(d.strokes).toHaveLength(2);
    expect(d.usage).toEqual({ input: 80, output: 600 });
  });
});

describe('providerName (shown after the model in the field)', () => {
  it('names the preset, else the API host', () => {
    expect(providerName({ kind: 'fake' })).toBeNull();
    expect(providerName({ kind: 'anthropic', apiKey: 'k', model: 'm' })).toBe('Anthropic');
    expect(providerName({ kind: 'openai', apiKey: 'k', model: 'm', baseUrl: 'https://api.fireworks.ai/inference/v1/' })).toBe('Fireworks');
    expect(providerName({ kind: 'openai', apiKey: 'k', model: 'm', baseUrl: 'https://api.example.com/v1' })).toBe('example.com');
    expect(providerName({ kind: 'openai', apiKey: 'k', model: 'm', baseUrl: 'not a url' })).toBeNull();
  });
});
