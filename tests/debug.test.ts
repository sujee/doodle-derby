import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLog, debug, debugFetch, debugOn, getLog, installDebug } from '../src/debug';
import { installDebugPanel } from '../src/debugPanel';
import { flush } from './helpers';

const toggle = installDebug();
const setDebug = (on: boolean) => {
  if (debugOn() !== on) toggle.click();
};

const IMAGE = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const guessBody = JSON.stringify({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'We are playing Pictionary.' }, { type: 'image_url', image_url: { url: IMAGE } }] }],
});
const ok = () =>
  new Response(JSON.stringify({ choices: [{ message: { content: 'cat | 70' }, finish_reason: 'stop' }], usage: { prompt_tokens: 812, completion_tokens: 4 } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
const call = (init: RequestInit = {}) =>
  debugFetch('https://api.openai.com/v1/chat/completions', { method: 'POST', body: guessBody, headers: { Authorization: 'Bearer sk-SECRET-123' }, ...init });

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
  clearLog();
});
afterEach(() => {
  setDebug(false);
  vi.unstubAllGlobals();
});

describe('debug logging off', () => {
  it('passes requests straight through and records nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok()));
    setDebug(false);
    const res = await call();
    expect(res.status).toBe(200);
    expect(getLog()).toHaveLength(0);
  });
});

describe('debug logging on', () => {
  it('records the call as one entry that fills in when the response arrives', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok()));
    setDebug(true);
    await (await call()).text();
    await flush();
    const [e] = getLog();
    expect(e.kind).toBe('call');
    expect(e.status).toBe('ok');
    expect(e.title).toMatch(/OpenAI-compatible · gpt-4o-mini · guess the drawing · .* sent/);
    expect(e.result).toMatch(/200 .*ms · tokens 812 in \/ 4 out/);
    const lines = Object.fromEntries(e.request!.lines.map((l) => [l.label, l.text]));
    expect(lines['Input size']).toMatch(/request body = 1 image .* \(base64\) \+ text and JSON/);
    expect(lines.Image).toMatch(/JPEG, 1×1 px/);
    expect(lines.Image).toMatch(/image_url.*base64 data URL/);
    expect(lines.Image).toMatch(/messages\[0\]\.content\[1\]\.image_url\.url/);
    const reply = Object.fromEntries(e.response!.lines.map((l) => [l.label, l.text]));
    expect(reply.Parsed).toBe('guess "cat", confidence 70%');
    expect(reply.Tokens).toBe('812 in · 4 out');
  });

  it('never records the API key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok()));
    setDebug(true);
    await (await call({ headers: { Authorization: 'Bearer sk-SECRET-123', 'x-api-key': 'sk-ant-SECRET' } })).text();
    await flush();
    const dump = JSON.stringify(getLog());
    expect(dump).not.toMatch(/SECRET/);
    const headers = Object.fromEntries(Object.entries(getLog()[0].rawRequest!.headers).map(([k, v]) => [k.toLowerCase(), v]));
    expect(headers).toMatchObject({ authorization: '[hidden]', 'x-api-key': '[hidden]' });
  });

  it('marks a call cancelled when the round ends before any response', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))));
    setDebug(true);
    const ac = new AbortController();
    const p = call({ signal: ac.signal }).catch(() => {});
    ac.abort();
    await p;
    expect(getLog()[0]).toMatchObject({ status: 'cancelled' });
    expect(getLog()[0].result).toMatch(/before any response/);
  });

  it('marks a call cancelled when the round ends while the response is arriving (was stuck on "waiting")', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = new ReadableStream({
          start(controller) {
            init.signal!.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
          },
        });
        return new Response(body, { status: 200 });
      }),
    );
    setDebug(true);
    const ac = new AbortController();
    const res = await call({ signal: ac.signal });
    expect(getLog()[0].result).toMatch(/headers after .* reading body/);
    ac.abort();
    await res.text().catch(() => {});
    await flush();
    expect(getLog()[0].status).toBe('cancelled');
    expect(getLog()[0].result).toMatch(/while the response was arriving/);
  });

  it('marks network failures and HTTP errors', async () => {
    setDebug(true);
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await call().catch(() => {});
    expect(getLog()[0]).toMatchObject({ status: 'error' });
    expect(getLog()[0].result).toMatch(/Failed to fetch/);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 })));
    await (await call()).text();
    await flush();
    const e = getLog()[1];
    expect(e.status).toBe('error');
    expect(e.response!.lines[0]).toMatchObject({ label: 'Error', text: 'bad key' });
  });

  it('game events are recorded too', () => {
    setDebug(true);
    debug('game', 'Round 1: "cat" (easy)');
    expect(getLog()[0]).toMatchObject({ kind: 'game', title: 'Round 1: "cat" (easy)' });
  });
});

describe('debug panel', () => {
  it('shows a pill only while debugging is on; opens, lists entries, and closes with Esc', async () => {
    const [pill, panel] = installDebugPanel();
    document.body.append(pill, panel);
    setDebug(false);
    expect(pill.hidden).toBe(true);
    setDebug(true);
    expect(pill.hidden).toBe(false);

    vi.stubGlobal('fetch', vi.fn(async () => ok()));
    await (await call()).text();
    await flush();
    debug('game', 'Round 1');
    expect(pill.textContent).toContain('2');

    pill.click();
    expect(panel.hidden).toBe(false);
    const rows = panel.querySelectorAll('.dbg-entry');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('summary')!.textContent).toMatch(/guess the drawing.*200/s);
    expect(panel.textContent).not.toMatch(/SECRET/);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panel.hidden).toBe(true);

    clearLog();
    expect(panel.querySelectorAll('.dbg-entry')).toHaveLength(0);
    setDebug(false);
    expect(pill.hidden).toBe(true);
    pill.remove();
    panel.remove();
  });
});
