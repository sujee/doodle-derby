// Refresh src/data/models-dev.json from https://models.dev/api.json.
// Keeps only the providers Doodle Duel talks to, and per model only price and image support,
// so the bundle stays small. Run with: npm run pricing
import { writeFile } from 'node:fs/promises';

const PROVIDERS = ['anthropic', 'openai', 'togetherai', 'fireworks-ai', 'nebius', 'baseten', 'ollama-cloud'];
const OUT = new URL('../src/data/models-dev.json', import.meta.url);

const res = await fetch('https://models.dev/api.json');
if (!res.ok) throw new Error(`models.dev returned HTTP ${res.status}`);
const all = await res.json();

const providers = {};
for (const id of PROVIDERS) {
  const p = all[id];
  if (!p) {
    console.warn(`models.dev has no provider "${id}", skipping`);
    continue;
  }
  const models = {};
  for (const [modelId, m] of Object.entries(p.models ?? {})) {
    const input = m.modalities?.input;
    models[modelId] = {
      ...(m.cost && typeof m.cost.input === 'number' ? { in: m.cost.input, out: m.cost.output ?? 0 } : {}),
      ...(Array.isArray(input) ? { img: input.includes('image') } : {}),
    };
  }
  providers[id] = { name: p.name, ...(p.api ? { api: p.api } : {}), models };
}

const data = { source: 'https://models.dev', fetched: new Date().toISOString().slice(0, 10), providers };
await writeFile(OUT, JSON.stringify(data, null, 1) + '\n');
const count = Object.values(providers).reduce((n, p) => n + Object.keys(p.models).length, 0);
console.log(`Wrote ${count} models from ${Object.keys(providers).length} providers to src/data/models-dev.json`);
