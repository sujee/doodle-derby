import { clearLog, entryText, getLog, onLog, prettyJson as pretty, type LogEntry, type Section } from './debug';
import { el } from './dom';

/**
 * The debug log: the 🐞 button (with a count of entries) opens a drawer listing every API call and
 * game event. Each call is one row that fills in when its response arrives; expanding it shows the
 * readable report and the raw request / response. While the drawer is closed it only updates the
 * count, and builds the rows when opened.
 */
export function installDebugPanel(): { button: HTMLButtonElement; panel: HTMLElement } {
  const count = el('span', { class: 'dbg-count' }, '0');
  const button = el('button', { type: 'button', class: 'debug-toggle', 'aria-expanded': 'false', title: 'Debug log: every API call and game event', 'aria-label': 'Open the debug log' }, [
    el('span', { 'aria-hidden': 'true' }, '🐞'),
    count,
  ]) as HTMLButtonElement;
  const list = el('div', { class: 'dbg-list', role: 'log', 'aria-live': 'off' });
  const empty = el('p', { class: 'dbg-empty' }, 'Nothing yet. API calls and game events will show up here as they happen.');
  const clear = el('button', { type: 'button', class: 'dbg-btn' }, 'Clear');
  const close = el('button', { type: 'button', class: 'dbg-btn', 'aria-label': 'Close the debug log' }, '✕');
  const head = el('header', { class: 'dbg-head', title: 'Double-click to reset the size' }, [
    el('strong', {}, '🐞 Debug log'),
    el('span', { class: 'dbg-note' }, 'API keys are never shown'),
    clear,
    close,
  ]);
  const panel = el('section', { class: 'dbg-panel', hidden: '', 'aria-label': 'Debug log' }, [
    head,
    list,
    // Drag handles on the sides that face the page (the panel is pinned top-right).
    el('div', { class: 'dbg-grip left', 'aria-hidden': 'true' }),
    el('div', { class: 'dbg-grip bottom', 'aria-hidden': 'true' }),
    el('div', { class: 'dbg-grip corner', 'aria-hidden': 'true' }),
  ]);
  makeResizable(panel, head);

  const rows = new Map<number, HTMLElement>();
  const rebuild = () => {
    rows.clear();
    list.replaceChildren(empty, ...getLog().map((e) => rows.set(e.id, renderEntry(e)).get(e.id)!));
  };
  const sync = () => {
    count.textContent = String(getLog().length);
    count.hidden = getLog().length === 0;
    empty.hidden = getLog().length > 0;
  };
  const setOpen = (open: boolean) => {
    if (open) rebuild();
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Close the debug log' : 'Open the debug log');
    if (open) list.scrollTop = list.scrollHeight;
  };

  button.addEventListener('click', () => setOpen(panel.hidden));
  // Esc closes the log (leaving other Esc handlers, like the share dialog, alone when it's closed).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || panel.hidden) return;
    e.stopPropagation();
    setOpen(false);
    button.focus({ preventScroll: true });
  });
  close.addEventListener('click', () => setOpen(false));
  clear.addEventListener('click', clearLog);

  onLog((entry) => {
    sync();
    if (panel.hidden) return; // built when opened
    if (!entry) return rebuild();
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
  });

  // Tick the elapsed time on pending calls while the panel is open.
  setInterval(() => {
    if (panel.hidden) return;
    for (const e of getLog()) {
      if (e.status !== 'pending') continue;
      const span = rows.get(e.id)?.querySelector(':scope > summary .dbg-result');
      if (span) span.textContent = resultText(e);
    }
  }, 1000);

  sync();
  return { button, panel };
}

const SIZE_KEY = 'doodle-derby-debug-size';

/** Drag the left edge, bottom edge or bottom-left corner to resize; the size is remembered. */
function makeResizable(panel: HTMLElement, head: HTMLElement) {
  const apply = (w: number, h: number) => {
    // Keep it on screen: the panel is fixed 12px from the right and 72px from the top.
    const width = Math.round(Math.min(Math.max(w, 280), window.innerWidth - 20));
    const height = Math.round(Math.min(Math.max(h, 180), window.innerHeight - 82));
    // On phones the drawer stays full width; only the height is adjustable.
    panel.style.width = window.innerWidth > 760 ? `${width}px` : '';
    panel.style.height = `${height}px`;
    return { width, height };
  };
  try {
    const saved = JSON.parse(localStorage.getItem(SIZE_KEY) ?? 'null');
    if (saved?.width && saved?.height) apply(saved.width, saved.height);
  } catch {
    // no saved size: keep the default
  }

  for (const grip of panel.querySelectorAll<HTMLElement>('.dbg-grip')) {
    grip.addEventListener('pointerdown', (down) => {
      down.preventDefault();
      grip.setPointerCapture(down.pointerId);
      const start = { x: down.clientX, y: down.clientY, w: panel.offsetWidth, h: panel.offsetHeight };
      const horizontal = !grip.classList.contains('bottom');
      const vertical = !grip.classList.contains('left');
      panel.classList.add('resizing');
      let size = { width: start.w, height: start.h };
      const move = (e: PointerEvent) => {
        size = apply(horizontal ? start.w + (start.x - e.clientX) : start.w, vertical ? start.h + (e.clientY - start.y) : start.h);
      };
      const up = () => {
        panel.classList.remove('resizing');
        grip.removeEventListener('pointermove', move);
        try {
          localStorage.setItem(SIZE_KEY, JSON.stringify(size));
        } catch {
          // storage blocked: the size lasts until reload
        }
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up, { once: true });
      grip.addEventListener('pointercancel', up, { once: true });
    });
  }

  head.addEventListener('dblclick', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    panel.style.width = '';
    panel.style.height = '';
    try {
      localStorage.removeItem(SIZE_KEY);
    } catch {
      // ignore
    }
  });
}

/** One log row: a summary line, and the details when expanded. Re-rendering keeps open sections open. */
function renderEntry(e: LogEntry, existing?: HTMLElement): HTMLElement {
  const row = (existing as HTMLDetailsElement) ?? (el('details', {}) as HTMLDetailsElement);
  const openRaw = [...row.querySelectorAll('details.dbg-raw')].map((d) => (d as HTMLDetailsElement).open);
  row.className = `dbg-entry ${e.kind} ${e.status}`;

  const CALL_TAG = { pending: '⏳', ok: '✓', cancelled: '⊘', error: '✗', info: '•' } as const;
  const tag = e.kind === 'call' ? CALL_TAG[e.status] : e.kind === 'error' ? '⚠' : '•';
  const summary = el('summary', {}, [
    el('span', { class: 'dbg-time' }, `${(e.at / 1000).toFixed(1)}s`),
    el('span', { class: 'dbg-tag', 'aria-hidden': 'true' }, tag),
    el('span', { class: 'dbg-title' }, e.title),
    ...(e.result || e.status === 'pending' ? [el('span', { class: 'dbg-result' }, resultText(e))] : []),
    copyButton('📋', () => entryText(e), 'dbg-copy', 'Copy this entry as text'),
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

/** The row's result line; while a call is pending it carries a live elapsed time. */
function resultText(e: LogEntry): string {
  if (e.status !== 'pending') return e.result ?? '';
  const secs = e.startedAt === undefined ? '' : `${((performance.now() - e.startedAt) / 1000).toFixed(0)}s`;
  return e.result ? `${e.result} ${secs}` : `waiting ${secs}…`;
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
  const full = () => `${first}\n\nHeaders:\n${JSON.stringify(headers, null, 2)}\n\nBody:\n${typeof body === 'string' ? body : JSON.stringify(body, null, 2)}`;
  const copy = copyButton('Copy', full, 'dbg-btn small');
  return el('details', { class: 'dbg-raw' }, [
    el('summary', {}, [title, copy]),
    el('pre', { class: 'dbg-pre' }, `${first}\n\nHeaders: ${pretty(headers)}\n\nBody: ${body === undefined ? '(none)' : pretty(body)}`),
  ]);
}

/** A button that copies text to the clipboard and says so, without toggling the row it sits in. */
function copyButton(label: string, text: () => string, cls: string, title?: string): HTMLButtonElement {
  const button = el('button', { type: 'button', class: cls, ...(title ? { title, 'aria-label': title } : {}) }, label) as HTMLButtonElement;
  button.addEventListener('click', async (ev) => {
    ev.preventDefault(); // a click inside <summary> would open or close the row
    ev.stopPropagation();
    const ok = await copyText(text());
    button.textContent = ok ? (label === 'Copy' ? 'Copied!' : '✓') : label === 'Copy' ? 'Copy failed' : '✗';
    setTimeout(() => (button.textContent = label), 1500);
  });
  return button;
}

/** Copy to the clipboard; where the Clipboard API is blocked (some embedded views), select-and-copy instead. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = el('textarea', { readonly: '', style: 'position:fixed; top:0; left:-9999px; opacity:0' }) as HTMLTextAreaElement;
    area.value = text;
    document.body.append(area);
    area.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}
