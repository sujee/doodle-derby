import { AnthropicGuesser, listAnthropicModels } from './anthropic';
import { FakeGuesser, type FakeContext } from './fake';
import { listOpenAIModels, OpenAICompatGuesser } from './openaiCompat';
import type { Guesser, GuesserConfig } from './types';
import type { ModelInfo } from './vision';

export function createGuesser(config: GuesserConfig, fake: FakeContext): Guesser {
  switch (config.kind) {
    case 'fake':
      return new FakeGuesser(fake);
    case 'openai':
      return new OpenAICompatGuesser(config.baseUrl, config.apiKey, config.model);
    case 'anthropic':
      return new AnthropicGuesser(config.apiKey, config.model);
  }
}

export function listModels(config: GuesserConfig): Promise<ModelInfo[]> {
  if (config.kind === 'openai') return listOpenAIModels(config.baseUrl, config.apiKey);
  if (config.kind === 'anthropic') return listAnthropicModels(config.apiKey);
  return Promise.resolve([]);
}

/** catalog: the provider's id on models.dev, for prices and image support. */
export type OpenAIPreset = { name: string; baseUrl: string; keyless?: boolean; catalog?: string; /** A shorter name for a small tag on a field row. */ short?: string };

export const OPENAI_PRESETS: OpenAIPreset[] = [
  { name: 'Nebius Token Factory', short: 'Nebius', baseUrl: 'https://api.tokenfactory.nebius.com/v1', catalog: 'nebius' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', catalog: 'openai' },
  { name: 'OpenAI compatible', baseUrl: '' },
  { name: 'Baseten', baseUrl: 'https://inference.baseten.co/v1', catalog: 'baseten' },
  { name: 'Together', baseUrl: 'https://api.together.xyz/v1', catalog: 'togetherai' },
  { name: 'Fireworks', baseUrl: 'https://api.fireworks.ai/inference/v1', catalog: 'fireworks-ai' },
  { name: 'Ollama Cloud', baseUrl: 'https://ollama.com/v1', catalog: 'ollama-cloud' },
  { name: 'Ollama local', baseUrl: 'http://localhost:11434/v1', keyless: true },
];

/**
 * Who serves the model, for the field rows ("qwen2.5-vl · Fireworks"): the preset's name, else the
 * API's host. Null for the Fake guesser, whose label already says it all.
 */
export function providerName(config: GuesserConfig): string | null {
  if (config.kind === 'fake') return null;
  if (config.kind === 'anthropic') return 'Anthropic';
  const url = config.baseUrl.trim().replace(/\/+$/, '');
  const preset = OPENAI_PRESETS.find((p) => p.baseUrl && p.baseUrl === url);
  if (preset) return preset.name;
  try {
    return new URL(url).hostname.replace(/^(api|www)\./, '');
  } catch {
    return null;
  }
}

/** The same, short enough for a tag on a field row when the bots use different providers ("Nebius"). */
export function providerTag(config: GuesserConfig): string | null {
  const full = providerName(config);
  if (!full) return null;
  return OPENAI_PRESETS.find((p) => p.name === full)?.short ?? full;
}

export type { FakeContext };
export * from './types';
export * from './vision';
