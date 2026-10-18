/** Inline SVG doodles and small visual effects. Static markup only; no user text goes through innerHTML. */

import { el } from './dom';
import { reducedMotion } from './sound';

const NS = 'http://www.w3.org/2000/svg';

function svg(markup: string, viewBox: string, cls: string): SVGSVGElement {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', viewBox);
  s.setAttribute('class', cls);
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = markup;
  return s;
}

// Shared shrug arms: hidden until the card gets .shrug.
const ARMS = `<g class="arms">
  <path class="ink" d="M14 70 Q6 60 8 48 M4 50 l4 -3 l4 3"/>
  <path class="ink" d="M86 70 Q94 60 92 48 M88 50 l4 -3 l4 3"/>
</g>`;

const BOTS = [
  // Doodlebot 1: boxy head, one antenna with a ball, round eyes.
  `<path class="ink" d="M50 18 Q49 10 51 5"/><circle class="ink bot-fill" cx="51" cy="5" r="4"/>
   <path class="ink bot-fill" d="M18 20 Q50 15 83 21 Q87 50 82 80 Q50 85 17 79 Q13 50 18 20 Z"/>
   <path class="ink face" d="M27 32 Q50 29 74 33 Q76 50 73 62 Q50 65 27 62 Q24 47 27 32 Z"/>
   <circle class="eye" cx="40" cy="45" r="5.5"/><circle class="eye" cx="61" cy="45" r="5.5"/>
   <circle class="glint" cx="42" cy="43" r="1.6"/><circle class="glint" cx="63" cy="43" r="1.6"/>
   <path class="ink mouth" d="M41 55 Q51 61 60 55"/>
   <path class="ink" d="M13 42 h-6 v14 h6 M88 42 h6 v14 h-6"/>
   <circle class="cheek" cx="31" cy="72" r="3"/><circle class="cheek" cx="40" cy="73" r="3"/><circle class="cheek" cx="49" cy="73" r="3"/>
   ${ARMS}`,
  // Doodlebot 2: dome head, two antennae, visor eyes.
  `<path class="ink" d="M36 24 L28 8 M64 24 L73 8"/><circle class="ink bot-fill" cx="28" cy="8" r="3.5"/><circle class="ink bot-fill" cx="73" cy="8" r="3.5"/>
   <path class="ink bot-fill" d="M16 60 Q14 22 50 20 Q87 21 84 60 Q85 82 50 83 Q16 82 16 60 Z"/>
   <path class="ink face" d="M25 38 Q50 33 76 38 Q78 46 75 53 Q50 57 25 53 Q22 46 25 38 Z"/>
   <path class="eye-bar" d="M33 45 h9 M58 45 h9"/>
   <path class="ink mouth" d="M40 66 Q50 72 60 66"/>
   <path class="ink" d="M44 76 h12"/>
   <circle class="cheek" cx="27" cy="64" r="4"/><circle class="cheek" cx="73" cy="64" r="4"/>
   ${ARMS}`,
  // Doodlebot 3: round head, light-bulb antenna, square eyes, zigzag mouth.
  `<path class="ink" d="M50 16 V8"/><path class="ink bot-fill" d="M44 8 Q44 -1 50 -1 Q56 -1 56 8 Z"/>
   <path class="ink bot-fill" d="M50 16 Q85 16 86 50 Q85 84 50 84 Q15 84 14 50 Q15 16 50 16 Z"/>
   <path class="ink face" d="M28 34 Q50 30 72 34 Q75 50 72 64 Q50 68 28 64 Q25 50 28 34 Z"/>
   <rect class="eye" x="34" y="40" width="9" height="9" rx="1.5"/><rect class="eye" x="57" y="40" width="9" height="9" rx="1.5"/>
   <path class="ink mouth" d="M38 57 l4 -3 l4 3 l4 -3 l4 3 l4 -3 l4 3"/>
   <path class="ink" d="M8 48 h6 M86 48 h6"/>
   ${ARMS}`,
];

// The GitHub mark (simple-icons), for the link to the source.
const GITHUB_MARK =
  '<path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>';

/** The GitHub mark, for the link to the source code. */
export function githubMark(): SVGSVGElement {
  return svg(GITHUB_MARK, '0 0 24 24', 'gh-mark');
}

/** The game's name, in its two colours: the small mark that sits at the top of every screen. */
export function wordmark(cls = 'brand'): HTMLElement {
  return el('div', { class: cls }, [el('span', { class: 'w1' }, 'Doodle'), ' ', el('span', { class: 'w2' }, 'Derby')]);
}

/** A robot face for guesser i (three designs repeat; the colour comes from botColor). */
export function robot(i: number): SVGSVGElement {
  return svg(BOTS[i % BOTS.length], '-2 -2 104 90', `bot bot${i % BOTS.length}`);
}

/** Hue step for the golden-angle spread: successive bots land far apart, and any set stays well spread. */
const GOLDEN_ANGLE = 137.508;

/**
 * A distinct colour for bot i. Hues are spread by the golden angle (starting at 25°, clear of the
 * red used for wrong guesses), so any number of bots look different — there is no limit. One band of
 * saturation and lightness, so they read the same on the sketchbook (light) and chalkboard (dark)
 * theme. Bots beyond the first dozen or so start to look similar, but a game won't have that many.
 */
export function botColor(i: number): string {
  const hue = Math.round((i * GOLDEN_ANGLE + 25) % 360);
  return `hsl(${hue} 68% 58%)`;
}

/** The doodler bot: the round-faced robot in sunshine yellow, holding a pencil (✏️ shown next to it). */
export function doodlerBot(): SVGSVGElement {
  return svg(BOTS[0], '-2 -2 104 90', 'bot doodler-bot');
}

/** The player: a smiley pencil-shaving face in mint. */
export function you(): SVGSVGElement {
  return svg(
    `<path class="ink bot-fill" d="M50 8 Q88 9 90 48 Q88 88 50 88 Q11 87 10 48 Q12 9 50 8 Z"/>
     <circle class="eye" cx="37" cy="40" r="5"/><circle class="eye" cx="63" cy="40" r="5"/>
     <path class="ink mouth" d="M32 58 Q50 74 68 58"/>
     <circle class="cheek" cx="25" cy="58" r="5"/><circle class="cheek" cx="75" cy="58" r="5"/>`,
    '0 0 100 96',
    'bot you-face',
  );
}

/** A trash can icon for Clear. */
export function trash(): SVGSVGElement {
  return svg(
    `<path class="ink" d="M7 9 h18 M13 9 V6 h6 v3"/>
     <path class="ink" d="M9 9 l1.5 18 h11 L23 9"/>
     <path class="ink" d="M13.5 13 v10 M18.5 13 v10"/>`,
    '0 0 32 32',
    'icon',
  );
}

/** A curly undo arrow. */
export function undoArrow(): SVGSVGElement {
  return svg(`<path class="ink" d="M10 12 h10 a6.5 6.5 0 0 1 0 13 h-7"/><path class="ink" d="M14 7 l-5 5 l5 5"/>`, '0 0 32 32', 'icon');
}

/** Four strips of tape, one per corner. */
export function tapes(): HTMLElement[] {
  return ['tl', 'tr', 'bl', 'br'].map((c) => el('span', { class: `tape ${c}`, 'aria-hidden': 'true' }));
}

const CONFETTI = ['#FFD23F', '#FF6B6B', '#4CC9F0', '#06D6A0', '#9B5DE5'];

/** Burst of confetti from the centre of host (position: relative). */
export function confetti(host: HTMLElement, count = 46) {
  if (reducedMotion()) return;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 90 + Math.random() * 220;
    const bit = el('span', { class: 'confetti', 'aria-hidden': 'true' });
    bit.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    bit.style.setProperty('--dy', `${Math.sin(angle) * dist - 80}px`);
    bit.style.setProperty('--rot', `${Math.random() * 720 - 360}deg`);
    bit.style.background = CONFETTI[i % CONFETTI.length];
    if (i % 3 === 0) bit.style.borderRadius = '50%';
    bit.style.animationDelay = `${Math.random() * 80}ms`;
    host.append(bit);
    setTimeout(() => bit.remove(), 1600);
  }
}

/** Restart a CSS animation class on an element (e.g. a bounce). */
export function replay(node: Element, cls: string) {
  node.classList.remove(cls);
  void (node as HTMLElement).offsetWidth;
  node.classList.add(cls);
}
