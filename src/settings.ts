/**
 * Game settings, applied to every model while you play. Thinking is the only one so far:
 *   "off"     — ask each endpoint to skip reasoning (fast and cheap; best effort)
 *   "default" — send nothing, and let the provider and model do their own thing
 * Read at request time, so a change takes effect on every model's next guess.
 */

import { el } from './dom';

const KEY = 'doodle-derby-thinking';

export type Thinking = 'off' | 'default';

let thinking: Thinking = readThinking();
const listeners: ((mode: Thinking) => void)[] = [];

function readThinking(): Thinking {
  try {
    return localStorage.getItem(KEY) === 'default' ? 'default' : 'off';
  } catch {
    return 'off';
  }
}

/** The current thinking mode; providers read this as they build each request. */
export const thinkingMode = () => thinking;

export function setThinking(mode: Thinking) {
  if (mode === thinking) return;
  thinking = mode;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // storage blocked: keep the choice for this tab only
  }
  listeners.forEach((fn) => fn(mode));
}

export function onThinkingChange(fn: (mode: Thinking) => void) {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

/** The ⚙ button and its panel: the settings menu in the corner tools. */
export function installSettings(): { button: HTMLButtonElement; panel: HTMLElement } {
  const button = el(
    'button',
    { type: 'button', class: 'settings-toggle', 'aria-expanded': 'false', title: 'Settings', 'aria-label': 'Open settings' },
    '⚙',
  ) as HTMLButtonElement;

  const inputs = new Map<Thinking, HTMLInputElement>();
  const option = (value: Thinking, label: string, why: string) => {
    const input = el('input', { type: 'radio', name: 'settings-thinking', value }) as HTMLInputElement;
    input.checked = thinkingMode() === value;
    input.addEventListener('change', () => input.checked && setThinking(value));
    inputs.set(value, input);
    return el('label', { class: 'check settings-opt' }, [input, el('span', {}, [el('strong', {}, label), ` — ${why}`])]);
  };

  const panel = el('section', { class: 'settings-panel', hidden: '', 'aria-label': 'Settings' }, [
    el('h2', {}, '⚙ Settings'),
    el('div', { class: 'settings-group' }, [
      el('p', { class: 'settings-label' }, 'Let models think'),
      option('off', 'Off', 'ask every model to skip its reasoning — fastest and cheapest'),
      option('default', 'Default', 'send nothing; each provider and model decides'),
    ]),
    el('p', { class: 'note settings-note' }, 'Applies to every model, from its next guess. Best effort: some models always think, and a few can’t be told either way.'),
  ]);

  onThinkingChange((mode) => {
    const input = inputs.get(mode);
    if (input) input.checked = true;
  });

  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  };
  button.addEventListener('click', () => setOpen(panel.hidden));
  document.addEventListener('pointerdown', (e) => {
    if (panel.hidden) return;
    const target = e.target as Node;
    if (!panel.contains(target) && target !== button && !button.contains(target)) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) {
      setOpen(false);
      button.focus();
    }
  });
  return { button, panel };
}
