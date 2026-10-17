/**
 * Debug logging: a 🐞 toggle next to the sound button. When on, every API request and response
 * (and the game's own events) is logged to the browser console. API keys are never logged; images
 * are logged as their size, plus a small preview of the snapshot.
 */

const KEY = 'doodle-duel-debug';
let on = load();

function load(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export const debugOn = () => on;

const STYLE = {
  request: 'color:#fff;background:#4cc9f0;padding:1px 6px;border-radius:4px',
  response: 'color:#fff;background:#06a37b;padding:1px 6px;border-radius:4px',
  error: 'color:#fff;background:#e85555;padding:1px 6px;border-radius:4px',
  game: 'color:#2b2b2b;background:#ffd23f;padding:1px 6px;border-radius:4px',
} as const;
type Kind = keyof typeof STYLE;

/** Log one event. `data` is shown expanded under a collapsed one-line header. */
export function debug(kind: Kind, title: string, data?: unknown) {
  if (!on) return;
  const label = `%c${kind}%c ${title}`;
  if (data === undefined) return console.log(label, STYLE[kind], '');
  console.groupCollapsed(label, STYLE[kind], '');
  console.log(sanitize(data));
  console.groupEnd();
}

/** Show a snapshot as an image in the console (Chrome, Edge, Firefox). */
export function debugImage(title: string, dataUrl: string) {
  if (!on) return;
  console.log(
    `%c ${title} (${kb(dataUrl)})`,
    `padding:64px 0 0 128px;background:#fff url("${dataUrl}") no-repeat left top/128px 128px;border:1px solid #2b2b2b;font-size:11px`,
  );
}

/** Copy of a request/response body that's safe and readable: no keys, images replaced by their size. */
export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 12) return '…';
  if (typeof value === 'string') {
    if (value.startsWith('data:image')) return `[image ${kb(value)}]`;
    if (value.length > 3000 && /^[A-Za-z0-9+/=]+$/.test(value.slice(0, 200))) return `[base64 ${kb(value)}]`;
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = /^(authorization|x-api-key|api[-_]?key)$/i.test(k) ? '[hidden]' : sanitize(v, depth + 1);
    }
    return out;
  }
  return value;
}

function kb(s: string) {
  return `${Math.round((s.length * 3) / 4 / 1024)} KB`;
}

/** The 🐞 button, fixed next to the sound toggle on every screen. */
export function installDebug(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'debug-toggle';
  const sync = () => {
    btn.textContent = '🐞';
    btn.title = on ? 'Debug logging on: requests and responses go to the browser console' : 'Debug logging off';
    btn.setAttribute('aria-label', on ? 'Turn debug logging off' : 'Turn debug logging on');
    btn.setAttribute('aria-pressed', String(on));
  };
  sync();
  btn.addEventListener('click', () => {
    on = !on;
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {
      // storage blocked: the setting lasts until reload
    }
    sync();
    console.info(
      on
        ? '%c🐞 Doodle Duel debug logging ON. Requests, responses and game events will appear here (API keys are never logged).'
        : '%c🐞 Doodle Duel debug logging OFF.',
      'font-weight:bold',
    );
  });
  return btn;
}
