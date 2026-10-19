import { version } from '../package.json';
import { githubMark, wordmark } from './art';
import { el } from './dom';

/**
 * The game's name and everything about it, pinned to the top-left of every screen: the version,
 * a GitHub mark linking to the source, the author's site and how to reach them. It sits in the
 * normal flow above the app, so it never covers anything, and its right padding keeps clear of the
 * fixed corner tools.
 */
export const REPO = 'https://github.com/sujee/doodle-derby';
const SITE = 'https://sujee.dev';
const TWITTER = 'https://x.com/sujee_dev';

/** An outside link: a new tab, and no referrer. */
function textLink(href: string, label: string): HTMLAnchorElement {
  return el('a', { href, rel: 'noreferrer', ...(href.startsWith('http') ? { target: '_blank' } : {}) }, label) as HTMLAnchorElement;
}

/** The "👋 Contact" button in the header and the little card it opens with the ways to get in touch. */
export function contactCard(): HTMLElement {
  const button = el(
    'button',
    { type: 'button', class: 'contact-toggle', 'aria-expanded': 'false', title: 'Contact me' },
    [el('span', { 'aria-hidden': 'true' }, '👋'), ' Contact'],
  ) as HTMLButtonElement;
  const panel = el('section', { class: 'contact-panel', hidden: '', 'aria-label': 'Contact' }, [
    el('h2', {}, '👋 Say hello'),
    el('p', {}, 'Found a bug, or have an idea? I’d love to hear it.'),
    el('div', { class: 'contact-links' }, [textLink(`${REPO}/issues/new`, '🐞 Open an issue'), textLink(TWITTER, '𝕏 @sujee_dev')]),
  ]);
  const wrap = el('div', { class: 'contact-wrap' }, [button, panel]);

  // The card hangs under the "?", but never off the screen — so it is placed, not just anchored.
  const place = () => {
    const r = wrap.getBoundingClientRect();
    const width = panel.offsetWidth || 280;
    panel.style.left = `${Math.max(12, Math.min(r.left - 14, window.innerWidth - width - 12))}px`;
    panel.style.top = `${r.bottom + 10}px`;
  };
  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) place();
  };
  button.addEventListener('click', () => setOpen(panel.hidden));
  window.addEventListener('resize', () => !panel.hidden && place());
  window.addEventListener('scroll', () => !panel.hidden && place(), { passive: true });
  panel.addEventListener('click', (e) => {
    if ((e.target as Element).closest('a')) setOpen(false); // follow the link, then tidy up
  });
  document.addEventListener('pointerdown', (e) => {
    if (!panel.hidden && !wrap.contains(e.target as Node)) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) {
      setOpen(false);
      button.focus();
    }
  });
  return wrap;
}

export function installHeader(): void {
  const source = el(
    'a',
    { class: 'gh', href: REPO, target: '_blank', rel: 'noreferrer', title: 'Source code on GitHub', 'aria-label': 'Source code on GitHub' },
    githubMark(),
  );
  document.body.prepend(
    el('header', { class: 'site-head' }, [
      wordmark(),
      el('div', { class: 'meta' }, [
        el('span', {}, `v${version}`),
        source,
        textLink(SITE, 'by sujee.dev'),
        contactCard(),
      ]),
    ]),
  );
}
