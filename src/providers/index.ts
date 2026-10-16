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
export type OpenAIPreset = { name: string; baseUrl: string; keyless?: boolean; catalog?: string };

export const OPENAI_PRESETS: OpenAIPreset[] = [
  { name: 'Nebius Token Factory', baseUrl: 'https://api.tokenfactory.nebius.com/v1', catalog: 'nebius' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', catalog: 'openai' },
  { name: 'OpenAI compatible', baseUrl: '' },
  { name: 'Baseten', baseUrl: 'https://inference.baseten.co/v1', catalog: 'baseten' },
  { name: 'Together', baseUrl: 'https://api.together.xyz/v1', catalog: 'togetherai' },
  { name: 'Fireworks', baseUrl: 'https://api.fireworks.ai/inference/v1', catalog: 'fireworks-ai' },
  { name: 'Ollama Cloud', baseUrl: 'https://ollama.com/v1', catalog: 'ollama-cloud' },
  { name: 'Ollama local', baseUrl: 'http://localhost:11434/v1', keyless: true },
];

export type { FakeContext };
export * from './types';
export * from './vision';
