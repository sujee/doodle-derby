import catalog from './data/models-dev.json';
import { OPENAI_PRESETS, type GuesserConfig } from './providers';

/**
 * Token prices from models.dev (bundled snapshot, refreshed with `npm run pricing`).
 * Prices are USD per 1M tokens.
 */

type Entry = { in?: number; out?: number; img?: boolean };
type Provider = { name: string; api?: string; models: Record<string, Entry> };
const PROVIDERS = catalog.providers as Record<string, Provider>;
export const PRICES_FETCHED = catalog.fetched;

export type Usage = { input: number; output: number; calls: number };
export type Price =
  | { kind: 'priced'; in: number; out: number }
  | { kind: 'free'; why: string }
  | { kind: 'unknown' };

const host = (url: string) => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
};

/** Which models.dev provider a guesser config talks to: an id, 'local', or null. */
function providerFor(config: GuesserConfig): string | null {
  if (config.kind === 'anthropic') return 'anthropic';
  if (config.kind !== 'openai') return null;
  const h = host(config.baseUrl);
  if (!h) return null;
  if (/^(localhost|127\.|\[::1\])/.test(h)) return 'local';
  const preset = OPENAI_PRESETS.find((p) => p.catalog && host(p.baseUrl) === h);
  if (preset?.catalog) return preset.catalog;
  // A custom URL that happens to be a known provider's API.
  return Object.entries(PROVIDERS).find(([, p]) => p.api && host(p.api) === h)?.[0] ?? null;
}

function entryFor(provider: string, model: string): Entry | undefined {
  const models = PROVIDERS[provider]?.models;
  if (!models) return undefined;
  if (models[model]) return models[model];
  const lower = model.toLowerCase();
  const tail = (id: string) => id.toLowerCase().split('/').pop()!;
  return (
    Object.entries(models).find(([id]) => id.toLowerCase() === lower)?.[1] ??
    Object.entries(models).find(([id]) => tail(id) === tail(model))?.[1]
  );
}

export function priceFor(config: GuesserConfig): Price {
  if (config.kind === 'fake') return { kind: 'free', why: 'fake bot' };
  const provider = providerFor(config);
  if (provider === 'local') return { kind: 'free', why: 'runs on your machine' };
  const e = provider ? entryFor(provider, config.model) : undefined;
  return e && typeof e.in === 'number' ? { kind: 'priced', in: e.in, out: e.out ?? 0 } : { kind: 'unknown' };
}

/** Image support according to models.dev, if it knows the model. */
export function catalogVision(config: GuesserConfig, model: string): boolean | undefined {
  const provider = providerFor(config);
  return provider && provider !== 'local' ? entryFor(provider, model)?.img : undefined;
}

/** Cost in USD, or null when the price is unknown. */
export function costOf(u: Usage, price: Price): number | null {
  if (price.kind === 'free') return 0;
  if (price.kind === 'unknown') return null;
  return (u.input * price.in + u.output * price.out) / 1e6;
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1e6).toFixed(1)}M`;
}

export function formatUsd(x: number | null): string {
  if (x === null) return 'price unknown';
  if (x === 0) return 'free';
  if (x < 0.01) return `$${x.toFixed(4)}`;
  return `$${x.toFixed(2)}`;
}
