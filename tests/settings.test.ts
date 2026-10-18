import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installSettings, setThinking, thinkingMode } from '../src/settings';

describe('the settings menu (thinking)', () => {
  beforeEach(() => setThinking('off'));
  afterEach(() => setThinking('off'));

  it('defaults to off, and the radio reflects and changes the mode', () => {
    const { button, panel } = installSettings();
    document.body.append(button, panel);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    button.click();
    expect(panel.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');

    const radios = [...panel.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.map((r) => r.value)).toEqual(['off', 'default']);
    expect(radios.find((r) => r.checked)!.value).toBe('off');

    const dflt = radios.find((r) => r.value === 'default')!;
    dflt.checked = true;
    dflt.dispatchEvent(new Event('change'));
    expect(thinkingMode()).toBe('default');

    button.click();
    expect(panel.hidden).toBe(true);
    button.remove();
    panel.remove();
  });
});
