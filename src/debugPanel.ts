import { clearLog, debugOn, getLog, onDebugChange, onLog, type LogEntry, type Section } from './debug';
import { el } from './dom';

/**
 * The in-game debug log: a "🐞 Log" pill in the corner (only while debug logging is on) that opens a
 * drawer listing every API call and game event. Each call is one row that fills in when its
 * response arrives; expanding it shows the readable report and the raw request / response.
 */
export function installDebugPanel(): HTMLElement[] {
  const count = el('span', { class: 'dbg-count' }, '0');
  const pill = el('button', { type: 'button', class: 'dbg-pill', 'aria-expanded': 'false', title: 'Show the debug log' }, ['🐞 Log ', count]);
  const list = el('div', { class: 'dbg-list', role: 'log', 'aria-live': 'off' });
  const empty = el('p', { class: 'dbg-empty' }, 'Nothing yet. API calls and game events will show up here as they happen.');
  const clear = el('button', { type: 'button', class: 'dbg-btn' }, 'Clear');
  const close = el('button', { type: 'button', class: 'dbg-btn', 'aria-label': 'Close the debug log' }, '✕');
  const panel = el('section', { class: 'dbg-panel', hidden: '', 'aria-label': 'Debug log' }, [
    el('header', { class: 'dbg-head' }, [el('strong', {}, '🐞 Debug log'), el('span', { class: 'dbg-note' }, 'API keys are never shown'), clear, close]),
    list,
  ]);

  const rows = new Map<number, HTMLElement>();
  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    pill.setAttribute('aria-expanded', String(open));
    if (open) list.scrollTop = list.scrollHeight;
  };
  const sync = () => {
    pill.hidden = !debugOn();
    if (!debugOn()) setOpen(false);
    count.textContent = String(getLog().length);
    empty.hidden = getLog().length > 0;
  };

  pill.addEventListener('click', () => setOpen(panel.hidden));
  close.addEventListener('click', () => setOpen(false));
  clear.addEventListener('click', clearLog);

  onDebugChange(sync);
  onLog((entry) => {
    if (!entry) {
      rows.clear();
      list.replaceChildren(empty);
      return sync();
    }
    // Stick to the bottom if we were already there.
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    const existing = rows.get(entry.id);
    const row = renderEntry(entry, existing);
    if (!existing) {
      rows.set(entry.id, row);
      list.append(row);
      // Keep the panel in step with the log's cap.
      for (const [id, r] of rows) {
        if (getLog().some((e) => e.id === id)) break;
        r.remove();
        rows.delete(id);
      }
    }
    if (atBottom) list.scrollTop = list.scrollHeight;
    sync();
  });

  list.append(empty);
  for (const e of getLog()) list.append(rows.set(e.id, renderEntry(e)).get(e.id)!);
  sync();
  return [pill, panel];
}

/** One log row: a summary line, and the details when expanded. Re-rendering keeps open sections open. */
function renderEntry(e: LogEntry, existing?: HTMLElement): HTMLElement {
  const row = (existing as HTMLDetailsElement) ?? (el('details', {}) as HTMLDetailsElement);
  const openRaw = [...row.querySelectorAll('details.dbg-raw')].map((d) => (d as HTMLDetailsElement).open);
  row.className = `dbg-entry ${e.kind} ${e.status}`;

  const tag = e.kind === 'call' ? (e.status === 'pending' ? '⏳' : e.status === 'ok' ? '✓' : '✗') : e.kind === 'error' ? '⚠' : '•';
  const summary = el('summary', {}, [
    el('span', { class: 'dbg-time' }, `${(e.at / 1000).toFixed(1)}s`),
    el('span', { class: 'dbg-tag', 'aria-hidden': 'true' }, tag),
    el('span', { class: 'dbg-title' }, e.title),
    ...(e.result ? [el('span', { class: 'dbg-result' }, e.result)] : e.status === 'pending' ? [el('span', { class: 'dbg-result' }, 'waiting…')] : []),
  ]);

  const body: Node[] = [];
  if (e.kind === 'call') {
    if (e.request) body.push(el('h4', {}, '→ Request'), renderSection(e.request));
    body.push(el('h4', {}, '← Response'), e.response ? renderSection(e.response) : el('p', { class: 'dbg-dim' }, e.result ?? 'waiting for the response…'));
    if (e.rawRequest) {
      const r = e.rawRequest;
      body.push(raw('Raw request', `${r.method} ${r.url}`, r.headers, r.body));
    }
    if (e.rawResponse) body.push(raw('Raw response', e.rawResponse.status, e.rawResponse.headers, e.rawResponse.body));
  } else {
    if (e.image) body.push(el('img', { class: 'dbg-thumb', src: e.image, alt: 'Snapshot sent to the bots' }));
    if (e.data !== undefined) body.push(el('pre', { class: 'dbg-pre' }, pretty(e.data)));
  }

  row.replaceChildren(summary, ...(body.length ? [el('div', { class: 'dbg-body' }, body)] : []));
  [...row.querySelectorAll('details.dbg-raw')].forEach((d, i) => ((d as HTMLDetailsElement).open = openRaw[i] ?? false));
  return row;
}

function renderSection(s: Section): HTMLElement {
  return el('div', { class: 'dbg-section' }, [
    ...s.lines.map((l) =>
      el('div', { class: 'dbg-line' }, [
        el('span', { class: 'dbg-label' }, l.label),
        el('span', { class: 'dbg-text' }, l.text.replace(/^\n/, '')),
        ...(l.data !== undefined ? [el('pre', { class: 'dbg-pre' }, pretty(l.data))] : []),
      ]),
    ),
    ...s.images.map((src) => el('img', { class: 'dbg-thumb', src, alt: 'Image sent in this request' })),
  ]);
}

/** A collapsible raw section; Copy puts the full, untruncated JSON on the clipboard. */
function raw(title: string, first: string, headers: Record<string, string>, body: unknown): HTMLElement {
  const copy = el('button', { type: 'button', class: 'dbg-btn small' }, 'Copy');
  copy.addEventListener('click', async (ev) => {
    ev.preventDefault();
    const full = `${first}\n\nHeaders:\n${JSON.stringify(headers, null, 2)}\n\nBody:\n${typeof body === 'string' ? body : JSON.stringify(body, null, 2)}`;
    try {
      await navigator.clipboard.writeText(full);
      copy.textContent = 'Copied!';
    } catch {
      copy.textContent = 'Copy failed';
    }
    setTimeout(() => (copy.textContent = 'Copy'), 1500);
  });
  return el('details', { class: 'dbg-raw' }, [
    el('summary', {}, [title, copy]),
    el('pre', { class: 'dbg-pre' }, `${first}\n\nHeaders: ${pretty(headers)}\n\nBody: ${body === undefined ? '(none)' : pretty(body)}`),
  ]);
}

/** Pretty JSON for reading; long base64 strings are shortened here (Copy and the console keep them whole). */
function pretty(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(
    value,
    (_k, v) => {
      if (typeof v !== 'string' || v.length < 300) return v;
      const b64 = v.startsWith('data:') ? v.slice(v.indexOf(',') + 1) : v;
      if (!/^[A-Za-z0-9+/=]+$/.test(b64.slice(0, 200))) return v;
      const kb = ((b64.length * 3) / 4 / 1024).toFixed(1);
      return `${v.slice(0, 48)}… [${kb} KB of base64, shortened here; Copy gives the full text]`;
    },
    2,
  );
}
