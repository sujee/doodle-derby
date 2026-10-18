import { afterEach, describe, expect, it } from 'vitest';
import { version } from '../package.json';
import { installHeader } from '../src/header';

// The header on every screen: the name, the version, the source link and the contact card.

afterEach(() => document.querySelector('.site-head')?.remove());

const install = () => {
  installHeader();
  return document.querySelector('.site-head') as HTMLElement;
};

const hrefs = (root: Element) => [...root.querySelectorAll('a')].map((a) => a.getAttribute('href'));

describe('the site header', () => {
  it('says the game’s name and version', () => {
    const head = install();
    expect(head.querySelector('.brand')?.textContent).toBe('Doodle Derby');
    expect(head.querySelector('.meta')?.firstElementChild?.textContent).toBe(`v${version}`);
  });

  it('links to the source repo with a GitHub mark', () => {
    const head = install();
    const gh = head.querySelector('a.gh')!;
    expect(gh.getAttribute('href')).toBe('https://github.com/sujee/doodle-derby');
    expect(gh.querySelector('svg.gh-mark')).not.toBeNull();
    expect(gh.getAttribute('aria-label')).toBe('Source code on GitHub');
  });

  it('keeps the contact details behind the "?" button', () => {
    const head = install();
    const button = head.querySelector<HTMLButtonElement>('.contact-toggle')!;
    const panel = head.querySelector<HTMLElement>('.contact-panel')!;

    expect(hrefs(panel)).toEqual(['https://x.com/sujee_dev', 'mailto:sujee@sujee.dev']);
    expect(panel.hidden).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');

    button.click();
    expect(panel.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panel.hidden).toBe(true);
  });

  it('links to sujee.dev beside the name', () => {
    expect(hrefs(install())).toContain('https://sujee.dev');
  });
});
