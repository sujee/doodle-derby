import { describe, expect, it } from 'vitest';
import { catalogVision, costOf, formatTokens, formatUsd, priceFor } from '../src/pricing';
import { sortModels, visionFromMetadata, visionFromName } from '../src/providers/vision';

describe('visionFromName', () => {
  it.each([
    ['gpt-4o-mini', 'likely'],
    ['Qwen/Qwen2.5-VL-72B-Instruct', 'likely'],
    ['google/gemma-3-27b-it', 'likely'],
    ['meta-llama/Llama-4-Maverick-17B', 'likely'],
    ['llava:13b', 'likely'],
    ['claude-sonnet-5-5', 'likely'],
    ['text-embedding-3-large', 'no'],
    ['gpt-4o-mini-tts', 'no'],
    ['whisper-1', 'no'],
    ['deepseek-v3', 'unknown'],
  ])('%s → %s', (id, vision) => {
    expect(visionFromName(id)).toBe(vision);
  });
});

describe('visionFromMetadata', () => {
  it('reads input-modality lists', () => {
    expect(visionFromMetadata({ id: 'x', architecture: { input_modalities: ['text', 'image'] } })).toBe('yes');
    expect(visionFromMetadata({ id: 'x', input_modalities: ['text'] })).toBe('no');
  });
  it('reads "text+image->text" modality strings (verbose model lists)', () => {
    expect(visionFromMetadata({ id: 'x', architecture: { modality: 'text+image->text' } })).toBe('yes');
    expect(visionFromMetadata({ id: 'x', architecture: { modality: 'text->text' } })).toBe('no');
  });
  it('reads boolean flags and capability lists', () => {
    expect(visionFromMetadata({ id: 'x', supports_image_input: true })).toBe('yes');
    expect(visionFromMetadata({ id: 'x', supports_vision: false })).toBe('no');
    expect(visionFromMetadata({ id: 'x', capabilities: ['completion', 'vision'] })).toBe('yes');
  });
  it('falls back to the name', () => {
    expect(visionFromMetadata({ id: 'gpt-4o' })).toBe('likely');
  });
});

describe('sortModels', () => {
  it('puts image-capable models first, then alphabetical', () => {
    const sorted = sortModels([
      { id: 'zed', vision: 'no' },
      { id: 'beta', vision: 'unknown' },
      { id: 'gamma', vision: 'likely' },
      { id: 'alpha', vision: 'yes' },
      { id: 'aardvark', vision: 'likely' },
    ]);
    expect(sorted.map((m) => m.id)).toEqual(['alpha', 'aardvark', 'gamma', 'beta', 'zed']);
  });
});

describe('priceFor', () => {
  const openai = (baseUrl: string, model: string) => ({ kind: 'openai' as const, baseUrl, apiKey: 'k', model });

  it('fake bots and local Ollama are free', () => {
    expect(priceFor({ kind: 'fake' })).toEqual({ kind: 'free', why: 'fake bot' });
    expect(priceFor(openai('http://localhost:11434/v1', 'gemma3'))).toEqual({ kind: 'free', why: 'runs on your machine' });
    expect(priceFor(openai('http://127.0.0.1:1234/v1', 'any'))).toMatchObject({ kind: 'free' });
  });

  it('finds known models through the preset or the provider’s API host', () => {
    expect(priceFor({ kind: 'anthropic', apiKey: 'k', model: 'claude-sonnet-5-5' })).toMatchObject({ kind: 'priced' });
    expect(priceFor(openai('https://api.openai.com/v1', 'gpt-4o-mini'))).toMatchObject({ kind: 'priced' });
    expect(priceFor(openai('https://api.fireworks.ai/inference/v1/', 'accounts/fireworks/models/kimi-k3'))).toMatchObject({ kind: 'priced' });
  });

  it('matches model ids case-insensitively and by the part after the slash', () => {
    const exact = priceFor(openai('https://api.tokenfactory.nebius.com/v1', 'google/gemma-3-27b-it'));
    expect(priceFor(openai('https://api.tokenfactory.nebius.com/v1', 'GOOGLE/GEMMA-3-27B-IT'))).toEqual(exact);
  });

  it('says unknown for unknown models or hosts', () => {
    expect(priceFor(openai('https://example.test/v1', 'foo'))).toEqual({ kind: 'unknown' });
    expect(priceFor(openai('https://api.openai.com/v1', 'not-a-model'))).toEqual({ kind: 'unknown' });
    expect(priceFor(openai('not a url', 'gpt-4o'))).toEqual({ kind: 'unknown' });
  });
});

describe('catalogVision', () => {
  it('knows image support from models.dev, and nothing for unknown or local models', () => {
    const nebius = { kind: 'openai' as const, baseUrl: 'https://api.tokenfactory.nebius.com/v1', apiKey: 'k', model: '' };
    expect(catalogVision(nebius, 'google/gemma-3-27b-it')).toBe(true);
    expect(catalogVision(nebius, 'no-such-model')).toBeUndefined();
    expect(catalogVision({ ...nebius, baseUrl: 'http://localhost:11434/v1' }, 'gemma3')).toBeUndefined();
  });
});

describe('cost and formatting', () => {
  it('costOf: tokens × price per million', () => {
    expect(costOf({ input: 1_000_000, output: 500_000, calls: 3 }, { kind: 'priced', in: 2, out: 10 })).toBeCloseTo(7, 10);
    expect(costOf({ input: 5, output: 5, calls: 1 }, { kind: 'free', why: 'fake bot' })).toBe(0);
    expect(costOf({ input: 5, output: 5, calls: 1 }, { kind: 'unknown' })).toBeNull();
  });

  it.each([
    [0, '0'],
    [999, '999'],
    [1234, '1.2k'],
    [12_345, '12k'],
    [1_500_000, '1.5M'],
  ])('formatTokens(%i) = %s', (n, s) => expect(formatTokens(n)).toBe(s));

  it.each([
    [null, 'price unknown'],
    [0, '$0.00'],
    [0.0042, '$0.0042'],
    [1.234, '$1.23'],
  ])('formatUsd(%s) = %s', (x, s) => expect(formatUsd(x)).toBe(s));
});
