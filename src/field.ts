/**
 * "The field": one row per guesser, stacked beside the canvas. A row shows the bot, its latest guess
 * big (crossed out in red if wrong, ✓ if right), its earlier guesses as greyed chips, and at the
 * right how many calls it has made this round, with its rounds won as a badge on the corner. The
 * round's winner gets a star and its own color. Display only; no game logic here.
 */

import { botColor, replay, robot } from './art';
import { el } from './dom';
import { speedTier } from './speed';

export class FieldRow {
  readonly el: HTMLElement;
  /** Requests sent this round, at the row's right end ("10 calls"), answered or not. */
  private callsEl = el('span', { class: 'row-guess-count' });
  /** How fast the winner's right guess was, as a pill after its name; empty until it wins. */
  private timeEl = el('span', { class: 'row-time' });
  /** Rounds won, as a badge on the row's top-right corner. */
  private winsEl = el('span', { class: 'row-wins', 'aria-hidden': 'true' }, '0 wins');

  /**
   * bubbles: [badge, feed]. The status badge (a warning or an error) goes beside the name; the feed
   * (latest guess first) gets the line below to itself.
   * score: the engine's score element, kept for screen readers; the row shows "N wins" itself.
   * art: the avatar (defaults to robot i); you() when You are guessing in bot-doodler mode.
   * provider: who serves the model: a short tag after its name (only when the bots differ), and the full
   * name on hover. A null tag keeps the name off the row (the field's title already says it).
   */
  constructor(index: number, label: string, bubbles: Node[], score: HTMLElement, art?: Element, provider?: { full: string; tag: string | null } | null) {
    score.classList.add('sr-only');
    this.el = el('div', { class: art ? 'field-row human' : 'field-row' }, [
      el('span', { class: 'win-star', 'aria-hidden': 'true' }, starSvg()),
      this.winsEl,
      el('div', { class: 'row-avatar', 'aria-hidden': 'true' }, art ?? robot(index)),
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-head' }, [
          el('div', { class: 'row-name' }, [
            el('h3', { title: provider ? `${label} · ${provider.full}` : label }, [
              shortLabel(label),
              ...(provider?.tag ? [el('span', { class: 'row-provider' }, provider.tag)] : []),
            ]),
            this.timeEl,
            bubbles[0],
          ]),
        ]),
        el('div', { class: 'row-guesses' }, bubbles.slice(1)),
      ]),
      el('div', { class: 'row-side' }, [this.callsEl, score]),
    ]);
    if (!art) this.el.style.setProperty('--lane', botColor(index));
  }

  /** How many calls the bot has made this round (cancelled ones too). Hidden at zero. */
  setCalls(n: number) {
    this.callsEl.textContent = n > 0 ? `${n} call${n === 1 ? '' : 's'}` : '';
  }

  setThinking(on: boolean) {
    this.el.classList.toggle('thinking', on);
  }

  /** Won this round: the star, its color, the new win count and how fast the right guess was. */
  win(score: number, secs: number | null = null) {
    this.el.classList.add('won');
    if (secs !== null) {
      this.timeEl.textContent = `${secs.toFixed(1)}s`;
      this.timeEl.className = `row-time ${speedTier(secs)}`;
    }
    this.winsEl.textContent = `${score} win${score === 1 ? '' : 's'}`;
    this.winsEl.classList.add('has-wins');
    replay(this.winsEl, 'bump');
  }

  /** New round: back to a plain row (the win count stays, the guess count restarts). */
  reset() {
    this.el.classList.remove('won', 'shrug');
    this.timeEl.textContent = '';
    this.setCalls(0);
  }

  /** Nobody got it this round. */
  shrug() {
    this.el.classList.add('shrug');
  }
}

/** "accounts/fireworks/models/qwen2p5-vl-32b" → "qwen2p5-vl-32b": the model name, without its path. */
function shortLabel(label: string): string {
  return label.split('/').pop() || label;
}

/** A sunny five-point star with an ink outline: sits on the round winner's corner. */
function starSvg(): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 40 40');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', 'M20 3 L24.9 14.1 L37 15.2 L27.9 23.2 L30.6 35 L20 28.8 L9.4 35 L12.1 23.2 L3 15.2 L15.1 14.1 Z');
  svg.append(path);
  return svg;
}
