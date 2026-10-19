import { afterEach, describe, expect, it } from 'vitest';
import { version } from '../package.json';
import { contactCard, installHeader } from '../src/header';

// The header on every screen: the name, the version, the source link and the contact card.

afterEach(() => {
  document.querySelector('.site-head')?.remove();
  document.querySelector('.contact-wrap')?.remove();
});

const install = () => {
  installHeader();
  return document.querySelector('.site-head') as HTMLElement;
};

const hrefs = (root: Element) => [...root.querySelectorAll('a')].map((a) => a.getAttribute('href'));

describe('the site header', () => {
  it('says the game’s name and version', () => {
    const head = install();
    expect(head.querySelector('.brand')?.textContent).toBe('Doodle Derby');
    expect(head.querySelector('.meta')?.firstElementChild?.textContent).toBe(`v${version.split('.')[0]}`);
  });

  it('links to the source repo with a GitHub mark', () => {
    const head = install();
    const gh = head.querySelector('a.gh')!;
    expect(gh.getAttribute('href')).toBe('https://github.com/sujee/doodle-derby');
    expect(gh.querySelector('svg.gh-mark')).not.toBeNull();
    expect(gh.getAttribute('aria-label')).toBe('Source code on GitHub');
  });

  it('has a Contact button beside the name', () => {
    expect(install().querySelector('.contact-toggle')?.textContent).toContain('Contact');
  });

  it('keeps the contact details behind the Contact button: open an issue, @sujee_dev, or GitHub /sujee', () => {
    document.body.append(contactCard());
    const button = document.querySelector<HTMLButtonElement>('.contact-toggle')!;
    const panel = document.querySelector<HTMLElement>('.contact-panel')!;

    expect(hrefs(panel)).toEqual(['https://github.com/sujee/doodle-derby/issues/new', 'https://x.com/sujee_dev', 'https://github.com/sujee']);
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
