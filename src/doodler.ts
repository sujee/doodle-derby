import { debug } from './debug';
import Anthropic from '@anthropic-ai/sdk';
import type { DrawingCanvas } from './canvas';
import { EFFORT_MODELS, FALLBACK_MODELS, toGuessError } from './providers/anthropic';
import { request, trimSlash } from './providers/openaiCompat';
import { GuessError, type GuesserConfig, type TokenUsage } from './providers/types';

/**
 * The bot doodler: a model draws the word as strokes, and a Sketcher animates them onto the canvas
 * so the guessers (bots and you) see it appear stroke by stroke.
 */

export type Pt = { x: number; y: number };
export type Stroke = Pt[];
export type Doodle = { strokes: Stroke[]; usage?: TokenUsage };

export interface Doodler {
  readonly label: string;
  draw(word: string, signal: AbortSignal): Promise<Doodle>;
}

const SIZE = 512;
const MAX_STROKES = 40;
const MAX_POINTS = 2500;

const PROMPT = (word: string) =>
  `You are the doodler in a Pictionary game. Draw a simple, recognizable line doodle of: "${word}".\n` +
  `The canvas is ${SIZE}×${SIZE} pixels, origin at the top left. Fill most of the canvas.\n` +
  'Reply with ONLY a JSON object: {"strokes": [[[x,y],[x,y],...], ...]}. ' +
  'Use 5–30 strokes; each stroke is a pen line through 2–40 points. Use many points for round shapes.\n' +
  'Never draw letters, numbers or any text, and never write the word. Draw like a quick, clear sketch.';

export function createDoodler(config: GuesserConfig): Doodler {
  switch (config.kind) {
    case 'fake':
      return new FakeDoodler();
    case 'openai':
      return new OpenAICompatDoodler(config.baseUrl, config.apiKey, config.model);
    case 'anthropic':
      return new AnthropicDoodler(config.apiKey, config.model);
  }
}

/** Parse a model reply into clean strokes: lenient about wrapping text, strict about coordinates. */
export function parseStrokes(text: string): Stroke[] {
  const start = text.search(/[{[]/);
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (start < 0 || end <= start) throw new GuessError('other', 'The doodler didn’t send a drawing');
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new GuessError('other', 'The doodler’s drawing was garbled');
  }
  const raw = Array.isArray(data) ? data : (data as { strokes?: unknown })?.strokes;
  if (!Array.isArray(raw)) throw new GuessError('other', 'The doodler’s drawing had no strokes');
  return cleanStrokes(raw);
}

export function cleanStrokes(raw: unknown[]): Stroke[] {
  const clamp = (v: number) => Math.min(SIZE, Math.max(0, v));
  const strokes: Stroke[] = [];
  let total = 0;
  for (const s of raw.slice(0, MAX_STROKES)) {
    if (!Array.isArray(s)) continue;
    const pts: Stroke = [];
    for (const p of s) {
      const x = Array.isArray(p) ? Number(p[0]) : Number((p as Pt)?.x);
      const y = Array.isArray(p) ? Number(p[1]) : Number((p as Pt)?.y);
      if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x: clamp(x), y: clamp(y) });
      if (++total > MAX_POINTS) break;
    }
    if (pts.length) strokes.push(pts);
    if (total > MAX_POINTS) break;
  }
  if (strokes.length === 0) throw new GuessError('other', 'The doodler’s drawing was empty');
  return strokes;
}

class AnthropicDoodler implements Doodler {
  readonly label: string;
  private client: Anthropic;

  constructor(
    apiKey: string,
    private model: string,
  ) {
    this.label = model;
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0 });
  }

  async draw(word: string, signal: AbortSignal): Promise<Doodle> {
    try {
      return await this.request(word, signal, true);
    } catch (e) {
      // Older models may not support structured outputs: try once more without the schema.
      if (e instanceof Anthropic.BadRequestError) return this.request(word, signal, false).catch((err) => Promise.reject(toGuessError(err)));
      throw toGuessError(e);
    }
  }

  private async request(word: string, signal: AbortSignal, structured: boolean): Promise<Doodle> {
    const point = { type: 'array', items: { type: 'number' } };
    const schema = {
      type: 'object',
      properties: { strokes: { type: 'array', items: { type: 'array', items: point } } },
      required: ['strokes'],
      additionalProperties: false,
    };
    const outputConfig = {
      ...(EFFORT_MODELS.test(this.model) ? { effort: 'low' as const } : {}),
      ...(structured ? { format: { type: 'json_schema' as const, schema } } : {}),
    };
    const started = performance.now();
    debug('request', `Anthropic ${this.model}: doodle "${word}"${structured ? ' (structured output)' : ''}`, { prompt: PROMPT(word) });
    const response = await this.client.beta.messages.create(
      {
        model: this.model,
        max_tokens: 16000,
        ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
        ...(FALLBACK_MODELS.test(this.model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        messages: [{ role: 'user', content: PROMPT(word) }],
      },
      { signal },
    );
    debug('response', `Anthropic ${this.model}: doodle ${response.stop_reason} (${Math.round(performance.now() - started)} ms)`, {
      content: response.content,
      usage: response.usage,
    });
    if (response.stop_reason === 'refusal') throw new GuessError('other', 'The doodler declined');
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') throw new GuessError('other', 'The doodler didn’t send a drawing');
    return {
      strokes: parseStrokes(text.text),
      usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
    };
  }
}

class OpenAICompatDoodler implements Doodler {
  readonly label: string;

  constructor(
    private baseUrl: string,
    private apiKey: string,
    private model: string,
  ) {
    this.label = model;
  }

  async draw(word: string, signal: AbortSignal): Promise<Doodle> {
    const res = await request(`${trimSlash(this.baseUrl)}/chat/completions`, this.apiKey, signal, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, messages: [{ role: 'user', content: PROMPT(word) }] }),
    });
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new GuessError('other', 'The doodler didn’t send a drawing');
    const u = data?.usage;
    return {
      strokes: parseStrokes(text),
      usage: typeof u?.prompt_tokens === 'number' ? { input: u.prompt_tokens, output: u.completion_tokens ?? 0 } : undefined,
    };
  }
}

/** No key needed: hand-made doodles for common easy words, and a generic squiggle for the rest. */
class FakeDoodler implements Doodler {
  readonly label = 'Fake doodler';

  async draw(word: string, signal: AbortSignal): Promise<Doodle> {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, 700 + Math.random() * 1200);
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
    const make = LIBRARY[word] ?? generic;
    return { strokes: make().map((s) => s.map((p) => ({ x: p.x + jitter(), y: p.y + jitter() }))) };
  }
}

const jitter = () => (Math.random() - 0.5) * 6;
const P = (x: number, y: number): Pt => ({ x, y });
const line = (...pts: [number, number][]): Stroke => pts.map(([x, y]) => P(x, y));
function arc(cx: number, cy: number, rx: number, ry = rx, from = 0, to = 360, n = 28): Stroke {
  const pts: Stroke = [];
  for (let i = 0; i <= n; i++) {
    const a = ((from + ((to - from) * i) / n) * Math.PI) / 180;
    pts.push(P(cx + rx * Math.cos(a), cy + ry * Math.sin(a)));
  }
  return pts;
}

const LIBRARY: Record<string, () => Stroke[]> = {
  sun: () => [
    arc(256, 256, 90),
    ...Array.from({ length: 8 }, (_, i) => {
      const a = (i * Math.PI) / 4;
      return line([256 + 120 * Math.cos(a), 256 + 120 * Math.sin(a)], [256 + 190 * Math.cos(a), 256 + 190 * Math.sin(a)]);
    }),
  ],
  ball: () => [arc(256, 256, 170), arc(256, 256, 170, 60, 0, 360), line([256, 86], [256, 426])],
  house: () => [
    line([110, 230], [110, 430], [400, 430], [400, 230]),
    line([80, 240], [255, 90], [430, 240]),
    line([220, 430], [220, 320], [290, 320], [290, 430]),
    line([140, 270], [190, 270], [190, 310], [140, 310], [140, 270]),
  ],
  tree: () => [line([230, 450], [235, 300]), line([285, 450], [280, 300]), arc(256, 210, 140, 120), line([180, 450], [340, 450])],
  fish: () => [arc(230, 256, 150, 85), line([375, 256], [460, 180], [460, 330], [375, 256]), arc(150, 235, 10), arc(290, 256, 40, 60, 120, 240, 10)],
  star: () => [
    Array.from({ length: 11 }, (_, i) => {
      const r = i % 2 ? 80 : 200;
      const a = (-90 + i * 36) * (Math.PI / 180);
      return P(256 + r * Math.cos(a), 270 + r * Math.sin(a));
    }),
  ],
  heart: () => [
    Array.from({ length: 41 }, (_, i) => {
      const t = (i / 40) * Math.PI * 2;
      return P(256 + 11 * 16 * Math.sin(t) ** 3, 240 - 11 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)));
    }),
  ],
  cup: () => [line([130, 140], [150, 420], [330, 420], [350, 140]), arc(256, 140, 110, 22), arc(375, 270, 50, 70, -90, 90, 16)],
  hat: () => [line([60, 380], [450, 380]), line([140, 380], [160, 150], [350, 150], [370, 380]), line([150, 320], [360, 320])],
  moon: () => [arc(256, 256, 170, 170, 60, 300), arc(330, 256, 135, 150, 115, 245)],
  apple: () => [arc(256, 290, 150, 140), line([256, 150], [270, 80]), line([270, 110], [330, 80], [300, 130], [270, 110])],
  'smiley face': () => [arc(256, 256, 190), arc(190, 200, 18), arc(322, 200, 18), arc(256, 270, 110, 90, 20, 160, 20)],
  snowman: () => [arc(256, 380, 110), arc(256, 210, 80), arc(256, 90, 55), arc(235, 80, 6), arc(277, 80, 6), line([256, 95], [300, 105])],
  egg: () => [arc(256, 270, 130, 175)],
  cloud: () => [arc(170, 280, 70, 70, 90, 270), arc(250, 220, 90, 90, 180, 360), arc(340, 280, 70, 70, 270, 450), line([170, 350], [340, 350])],
  flower: () => [
    ...Array.from({ length: 6 }, (_, i) => arc(256 + 70 * Math.cos((i * Math.PI) / 3), 180 + 70 * Math.sin((i * Math.PI) / 3), 45)),
    arc(256, 180, 35),
    line([256, 260], [250, 470]),
    line([252, 380], [320, 330]),
  ],
  car: () => [line([60, 330], [60, 260], [150, 250], [200, 180], [340, 180], [390, 250], [450, 260], [450, 330], [60, 330]), arc(150, 340, 45), arc(360, 340, 45)],
  key: () => [arc(150, 256, 75), line([225, 256], [450, 256]), line([400, 256], [400, 310]), line([350, 256], [350, 300])],
  door: () => [line([150, 470], [150, 60], [360, 60], [360, 470]), arc(320, 280, 14)],
  eye: () => [arc(256, 256, 200, 100, 180, 360), arc(256, 256, 200, 100, 0, 180), arc(256, 256, 70), arc(256, 256, 25)],
  banana: () => [arc(256, 120, 220, 260, 40, 140, 24), arc(256, 70, 230, 230, 50, 130, 24)],
  cat: () => [arc(256, 280, 150, 130), line([140, 200], [150, 80], [220, 160]), line([290, 160], [362, 80], [372, 200]), arc(205, 260, 14), arc(307, 260, 14), line([150, 320], [60, 300]), line([362, 320], [450, 300])],
};

function generic(): Stroke[] {
  const n = 3 + Math.floor(Math.random() * 3);
  return Array.from({ length: n }, (_, i) =>
    i % 2 ? arc(150 + Math.random() * 210, 150 + Math.random() * 210, 50 + Math.random() * 70) : line([80 + Math.random() * 100, 100 + Math.random() * 300], [330 + Math.random() * 100, 100 + Math.random() * 300]),
  );
}

/** Animates strokes onto the canvas: call tick(ms) every frame; done once every point is drawn. */
export class Sketcher {
  private points: { p: Pt; first: boolean }[] = [];
  private drawn = 0;
  private elapsed = 0;
  readonly duration: number;

  constructor(
    private canvas: DrawingCanvas,
    strokes: Stroke[],
  ) {
    // Densify long segments so lines grow smoothly instead of jumping.
    for (const s of strokes) {
      s.forEach((p, i) => {
        if (i > 0) {
          const prev = s[i - 1];
          const steps = Math.min(20, Math.floor(Math.hypot(p.x - prev.x, p.y - prev.y) / 10));
          for (let k = 1; k < steps; k++) {
            this.points.push({ p: { x: prev.x + ((p.x - prev.x) * k) / steps, y: prev.y + ((p.y - prev.y) * k) / steps }, first: false });
          }
        }
        this.points.push({ p, first: i === 0 });
      });
    }
    this.duration = Math.min(15_000, Math.max(8_000, this.points.length * 12));
  }

  get done() {
    return this.drawn >= this.points.length;
  }

  tick(ms: number) {
    this.elapsed += ms;
    const target = Math.min(this.points.length, Math.ceil((this.points.length * this.elapsed) / this.duration));
    while (this.drawn < target) {
      const { p, first } = this.points[this.drawn++];
      if (first) this.canvas.beginStroke(p);
      else this.canvas.extendStroke(p);
    }
  }
}
