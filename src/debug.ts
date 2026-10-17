/**
 * The debug log. Every API call is recorded as a readable report (what was asked, how the image was
 * sent, what came back) with the raw request and response, alongside the game's own events. The
 * 🐞 button opens it (debugPanel.ts). Recording is always on: it's local, cheap and capped at
 * MAX_ENTRIES, so the history is there whenever something goes wrong. API keys are never recorded.
 */

import { parseGuess } from './providers/types';

// ---------------------------------------------------------------------------------------------
// The log: structured entries, shared by the console output and the in-game panel.

export type Line = { label: string; text: string; data?: unknown };
export type Section = { lines: Line[]; images: string[] };
export type LogEntry = {
  id: number;
  at: number; // ms since page load
  kind: 'call' | 'game' | 'error';
  /** One-line summary: what was called, then (for calls) status, time and tokens once known. */
  title: string;
  status: 'pending' | 'ok' | 'error' | 'cancelled' | 'info';
  /** performance.now() when a call went out, for the live "waiting 12s" counter. */
  startedAt?: number;
  result?: string;
  request?: Section;
  response?: Section;
  rawRequest?: { method: string; url: string; headers: Record<string, string>; body: unknown };
  rawResponse?: { status: string; headers: Record<string, string>; body: unknown };
  /** Game events: an optional image (snapshot) and details. */
  image?: string;
  data?: unknown;
};

const MAX_ENTRIES = 300;
const entries: LogEntry[] = [];
const listeners = new Set<(e: LogEntry | null) => void>();
let nextId = 0;

export const getLog = (): readonly LogEntry[] => entries;
/** Called with the entry that was added or changed, or null when the log was cleared. */
export const onLog = (fn: (e: LogEntry | null) => void) => listeners.add(fn);

export function clearLog() {
  entries.length = 0;
  listeners.forEach((fn) => fn(null));
}

function record(e: Omit<LogEntry, 'id' | 'at'>): LogEntry {
  const entry = { ...e, id: ++nextId, at: performance.now() };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
  listeners.forEach((fn) => fn(entry));
  return entry;
}

function changed(entry: LogEntry) {
  listeners.forEach((fn) => fn(entry));
}

type Kind = 'game' | 'error';

/** A game event, with optional details shown when expanded. */
export function debug(kind: Kind, title: string, data?: unknown) {
  record({ kind, title, status: kind === 'error' ? 'error' : 'info', data });
}

/** A snapshot sent to the bots, shown as an image in the log. */
export function debugImage(title: string, dataUrl: string) {
  record({ kind: 'game', title: `${title}: ${describeImage(dataUrl)}`, status: 'info', image: dataUrl });
}

/**
 * One entry as plain text, for the row's copy button: the summary line, then the readable request
 * and response. Images become a one-line description and raw bodies are left out, so it pastes well.
 */
export function entryText(e: LogEntry): string {
  const result = e.result ?? (e.status === 'pending' ? 'waiting…' : '');
  const out = [`${(e.at / 1000).toFixed(1)}s  [${e.status}]  ${e.title}${result ? `  →  ${result}` : ''}`];
  const section = (heading: string, s: Section) => {
    out.push('', heading);
    for (const l of s.lines) {
      const text = l.text.replace(/^\n/, '');
      out.push(`  ${l.label}: ${text}`.trimEnd().replace(/\n/g, '\n    '));
      if (l.data !== undefined) out.push(indent(prettyJson(l.data), 4));
    }
    for (const img of s.images) out.push(`  Image: ${describeImage(img)}`);
  };
  if (e.request) section('→ Request', e.request);
  if (e.response) section('← Response', e.response);
  else if (e.kind === 'call') out.push('', '← Response', `  ${e.result ?? 'waiting for the response…'}`);
  if (e.image) out.push(`  Image: ${describeImage(e.image)}`);
  if (e.data !== undefined) out.push(indent(prettyJson(e.data), 2));
  return out.join('\n');
}

const indent = (text: string, n: number) => text.replace(/^/gm, ' '.repeat(n));

/** Pretty JSON for reading; long base64 strings (images) are shortened to their size. */
export function prettyJson(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(
    value,
    (_k, v) => {
      if (typeof v !== 'string' || v.length < 300) return v;
      const b64 = v.startsWith('data:') ? v.slice(v.indexOf(',') + 1) : v;
      if (!/^[A-Za-z0-9+/=]+$/.test(b64.slice(0, 200))) return v;
      const kb = ((b64.length * 3) / 4 / 1024).toFixed(1);
      return `${v.slice(0, 48)}… [${kb} KB of base64, shortened]`;
    },
    2,
  );
}

// ---------------------------------------------------------------------------------------------
// API calls: a fetch wrapper that both providers use (the Anthropic SDK takes it as `fetch`).

/** fetch(), plus a readable report of the request and response in the log. */
export const debugFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const raw = typeof init?.body === 'string' ? init.body : undefined;
  const body = parseJson(raw);
  const call = describeCall(url, method, body);
  const headers = hideKeys(headersOf(init?.headers));
  const bytes = raw ? new Blob([raw]).size : 0;
  const request = requestSection(call, method, headers, body, bytes);
  const entry = record({
    kind: 'call',
    title: `${call.title}${bytes ? ` · ${formatBytes(bytes)} sent` : ''}`,
    status: 'pending',
    request,
    rawRequest: { method, url, headers, body },
  });


  const started = performance.now();
  entry.startedAt = started;
  try {
    const res = await fetch(input, init);
    const headersMs = Math.round(performance.now() - started);
    // Headers are in; the body may still be streaming (slow models, proxies that flush early).
    entry.result = `${res.status} ${res.statusText} · headers after ${headersMs} ms · reading body…`.replace('  ', ' ');
    changed(entry);
    res
      .clone()
      .text()
      .then((text) => {
        const ms = Math.round(performance.now() - started);
        try {
          logResponse(entry, call, res, ms, parseJson(text) ?? text, new Blob([text]).size);
        } catch (err) {
          // Never leave a row hanging because the report itself failed.
          entry.status = 'error';
          entry.result = `${res.status} · ${ms} ms · couldn't build the report: ${(err as Error)?.message}`;
          entry.rawResponse = { status: `HTTP ${res.status} ${res.statusText}`.trim(), headers: Object.fromEntries(res.headers.entries()), body: text };
          changed(entry);
        }
      })
      .catch((err) => {
        // The body never finished: usually the round ended or the game was paused mid-response.
        const cancelled = (err as Error)?.name === 'AbortError' || init?.signal?.aborted;
        const ms = Math.round(performance.now() - started);
        entry.status = cancelled ? 'cancelled' : 'error';
        entry.result = cancelled
          ? `${res.status} · cancelled after ${ms} ms while the response was arriving (round ended or paused)`
          : `${res.status} · failed reading the response after ${ms} ms: ${(err as Error)?.message}`;
        changed(entry);
      });
    return res;
  } catch (e) {
    const cancelled = (e as Error)?.name === 'AbortError' || init?.signal?.aborted;
    const ms = Math.round(performance.now() - started);
    entry.status = cancelled ? 'cancelled' : 'error';
    entry.result = cancelled
      ? `cancelled after ${ms} ms, before any response (round ended or paused)`
      : `failed after ${ms} ms: ${(e as Error)?.message} (network error, blocked by CORS, or wrong URL)`;
    changed(entry);
    throw e;
  }
};

type Call = { provider: string; purpose: string; model: string; title: string };

function describeCall(url: string, method: string, body: any): Call {
  const anthropic = /anthropic\.com/.test(url);
  const provider = anthropic ? 'Anthropic' : 'OpenAI-compatible';
  const model = typeof body?.model === 'string' ? body.model : '';
  const prompt = promptOf(body, anthropic);
  const purpose = /\/models\b/.test(url) && method === 'GET'
    ? 'list models'
    : /You are the doodler/.test(prompt)
      ? 'draw a doodle'
      : imagesOf(body, anthropic).length
        ? 'guess the drawing'
        : 'request';
  return { provider, purpose, model, title: [provider, model, purpose].filter(Boolean).join(' · ') };
}

function requestSection(call: Call, method: string, headers: Record<string, string>, body: any, bytes: number): Section {
  const anthropic = call.provider === 'Anthropic';
  const images = imagesOf(body, anthropic);
  const lines: Line[] = [];
  if (bytes) {
    // Image bytes as they travel: the base64 text inside the JSON body.
    const imageBytes = images.reduce((n, img) => n + (img.dataUrl.length - img.dataUrl.indexOf(',') - 1), 0);
    const parts = images.length
      ? ` = ${images.length} image${images.length > 1 ? 's' : ''} ${formatBytes(imageBytes)} (base64) + text and JSON ${formatBytes(bytes - imageBytes)}`
      : '';
    lines.push({ label: 'Input size', text: `${formatBytes(bytes)} request body${parts}` });
  }
  const prompt = promptOf(body, anthropic);
  if (prompt) lines.push({ label: 'Prompt', text: `\n${prompt}` });
  for (const img of images) {
    const b64Bytes = img.dataUrl.length - img.dataUrl.indexOf(',') - 1;
    lines.push({
      label: 'Image',
      text: `${describeImage(img.dataUrl)} file → ${formatBytes(b64Bytes)} as base64 text in the request\nSent as ${img.how}\nAt ${img.path}`,
    });
  }
  const settings = settingsOf(body, headers);
  if (Object.keys(settings).length) lines.push({ label: 'Settings', text: '', data: settings });
  if (!body) lines.push({ label: 'Body', text: `none (${method} request)` });
  return { lines, images: images.map((i) => i.dataUrl) };
}

function logResponse(entry: LogEntry, call: Call, res: Response, ms: number, body: any, bytes: number) {
  const usage = tokensOf(body);
  const lines: Line[] = [];
  if (!res.ok) {
    lines.push({ label: 'Error', text: body?.error?.message ?? body?.message ?? (typeof body === 'string' ? body : JSON.stringify(body)) });
  } else if (call.purpose === 'list models') {
    const list = Array.isArray(body) ? body : (body?.data ?? []);
    lines.push({ label: 'Models', text: `${list.length} returned: ${list.map((m: any) => m?.id).join(', ')}` });
  } else {
    const reply = replyOf(body);
    if (reply.thinking) lines.push({ label: 'Thinking', text: reply.thinking });
    if (reply.text !== null) {
      const shown = reply.text.length > 600 ? `${reply.text.slice(0, 600)}… (${reply.text.length} chars; full text in Raw response)` : reply.text;
      lines.push({ label: 'Reply', text: `\n${shown}` });
      if (call.purpose === 'guess the drawing') {
        const { guess, confidence } = parseGuess(reply.text);
        lines.push({ label: 'Parsed', text: `guess "${guess}", confidence ${confidence === null ? 'not given' : `${confidence}%`}` });
      }
    }
    if (reply.stop) lines.push({ label: 'Stopped because', text: reply.stop });
    if (reply.tokens) lines.push({ label: 'Tokens', text: reply.tokens });
  }
  const resHeaders = Object.fromEntries(res.headers.entries());
  entry.status = res.ok ? 'ok' : 'error';
  entry.result = `${res.status} ${res.statusText} · ${ms} ms${usage ? ` · tokens ${usage.input} in / ${usage.output} out` : ''} · ${formatBytes(bytes)}`.replace('  ', ' ');
  entry.response = { lines, images: [] };
  entry.rawResponse = { status: `HTTP ${res.status} ${res.statusText}`.trim(), headers: resHeaders, body };
  changed(entry);

}

/** Input / output token counts from either API's usage block. */
function tokensOf(body: any): { input: number; output: number } | null {
  const u = body?.usage;
  if (!u) return null;
  if (typeof u.input_tokens === 'number') return { input: u.input_tokens, output: u.output_tokens ?? 0 };
  if (typeof u.prompt_tokens === 'number') return { input: u.prompt_tokens, output: u.completion_tokens ?? 0 };
  return null;
}

/** All text parts of the user message(s). */
function promptOf(body: any, anthropic: boolean): string {
  const texts: string[] = [];
  for (const m of body?.messages ?? []) {
    if (typeof m.content === 'string') texts.push(m.content);
    else for (const part of m.content ?? []) if (part?.type === 'text') texts.push(part.text);
  }
  if (anthropic && typeof body?.system === 'string') texts.unshift(`[system] ${body.system}`);
  return texts.join('\n');
}

/** Every image in the request, with where it sits and how it's encoded. */
function imagesOf(body: any, anthropic: boolean): { dataUrl: string; how: string; path: string }[] {
  const out: { dataUrl: string; how: string; path: string }[] = [];
  (body?.messages ?? []).forEach((m: any, i: number) => {
    if (!Array.isArray(m.content)) return;
    m.content.forEach((part: any, j: number) => {
      if (anthropic && part?.type === 'image' && part.source?.type === 'base64') {
        out.push({
          dataUrl: `data:${part.source.media_type};base64,${part.source.data}`,
          how: `an "image" content block: source.type "base64", media_type "${part.source.media_type}", data = the base64 bytes (no data: prefix)`,
          path: `messages[${i}].content[${j}]`,
        });
      } else if (!anthropic && part?.type === 'image_url') {
        const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
        if (typeof url === 'string') {
          out.push({
            dataUrl: url,
            how: url.startsWith('data:')
              ? `an "image_url" content part holding a base64 data URL ("data:image/…;base64,…")${part.image_url?.detail ? `, detail "${part.image_url.detail}"` : ''}`
              : 'an "image_url" content part with a web URL',
            path: `messages[${i}].content[${j}].image_url.url`,
          });
        }
      }
    });
  });
  return out;
}

/** Request options other than the messages, plus the API version and beta headers. */
function settingsOf(body: any, headers: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (body && typeof body === 'object') {
    for (const [k, v] of Object.entries(body)) if (k !== 'messages') out[k] = v;
  }
  for (const [k, v] of Object.entries(headers)) {
    if (/^anthropic-(version|beta)$/i.test(k)) out[`header ${k}`] = v;
  }
  return out;
}

/** The model's reply text, thinking summary, stop reason and token counts, for both API shapes. */
function replyOf(body: any): { text: string | null; thinking: string; stop: string; tokens: string } {
  if (Array.isArray(body?.content)) {
    // Anthropic Messages API
    const text = body.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    const thinkingBlocks = body.content.filter((b: any) => b.type === 'thinking');
    const thinking = thinkingBlocks.length
      ? `${thinkingBlocks.length} thinking block(s)${thinkingBlocks.some((b: any) => b.thinking) ? ': ' + thinkingBlocks.map((b: any) => b.thinking).join(' ') : ' (content not returned)'}`
      : '';
    const u = body.usage ?? {};
    return {
      text,
      thinking,
      stop: body.stop_reason ?? '',
      tokens: u.input_tokens !== undefined ? `${u.input_tokens} in · ${u.output_tokens} out (output includes any thinking)` : '',
    };
  }
  const choice = body?.choices?.[0];
  const u = body?.usage ?? {};
  return {
    text: typeof choice?.message?.content === 'string' ? choice.message.content : null,
    thinking: typeof choice?.message?.reasoning_content === 'string' ? choice.message.reasoning_content : '',
    stop: choice?.finish_reason ?? '',
    tokens: u.prompt_tokens !== undefined ? `${u.prompt_tokens} in · ${u.completion_tokens} out` : '',
  };
}

/** "JPEG, 512×512 px, 7 KB" from a data URL. */
function describeImage(dataUrl: string): string {
  const mime = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? 'unknown type';
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const size = imageSize(b64, mime);
  return `${mime.replace('image/', '').toUpperCase()}${size ? `, ${size.w}×${size.h} px` : ''}, ${kb(b64)}`;
}

/** Width and height from the PNG or JPEG header, without decoding the image. */
function imageSize(b64: string, mime: string): { w: number; h: number } | null {
  try {
    const bytes = Uint8Array.from(atob(b64.slice(0, 40_000)), (c) => c.charCodeAt(0));
    if (mime === 'image/png' && bytes.length > 24) {
      const v = new DataView(bytes.buffer);
      return { w: v.getUint32(16), h: v.getUint32(20) };
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) return null;
        const marker = bytes[i + 1];
        const len = (bytes[i + 2] << 8) | bytes[i + 3];
        if (marker >= 0xc0 && marker <= 0xc3) return { h: (bytes[i + 5] << 8) | bytes[i + 6], w: (bytes[i + 7] << 8) | bytes[i + 8] };
        i += 2 + len;
      }
    }
  } catch {
    // not decodable: size unknown
  }
  return null;
}

function headersOf(h: HeadersInit | undefined): Record<string, string> {
  if (!h) return {};
  if (h instanceof Headers) return Object.fromEntries(h.entries());
  if (Array.isArray(h)) return Object.fromEntries(h);
  return { ...(h as Record<string, string>) };
}

function hideKeys(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = /^(authorization|x-api-key|api-key)$/i.test(k) ? '[hidden]' : v;
  }
  return out;
}

function parseJson(text: string | undefined): any {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function kb(b64: string) {
  return formatBytes((b64.length * 3) / 4);
}

function formatBytes(bytes: number) {
  return bytes < 1024 ? `${Math.round(bytes)} bytes` : `${(bytes / 1024).toFixed(1)} KB`;
}
