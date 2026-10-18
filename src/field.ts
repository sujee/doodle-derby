/**
 * "The field": one row per guesser, stacked beside the canvas. A row shows the bot, its latest guess
 * big (crossed out in red if wrong, ✓ if right), its earlier guesses as crossed-out chips, and on the
 * right its winning time and rounds won. The round's winner gets a crown and its own color.
 * Display only; no game logic here.
 */

import { robot } from './art';
import { el } from './dom';

export class FieldRow {
  readonly el: HTMLElement;
  private timeEl = el('span', { class: 'row-time' });
  private winsEl = el('span', { class: 'row-wins' }, '0 wins');

  /**
   * bubbles: [badge, feed]. The status badge (thinking, cancelled…) goes beside the name; the feed
   * (latest guess first) gets the line below to itself.
   * score: the engine's score element, kept for screen readers; the row shows "N wins" itself.
   * art: the avatar (defaults to robot i); you() when You are guessing in bot-doodler mode.
   */
  constructor(index: number, label: string, bubbles: Node[], score: HTMLElement, meter?: Node, art?: Element) {
    score.classList.add('sr-only');
    this.el = el('div', { class: art ? 'row human' : `row p${index}` }, [
      el('span', { class: 'crown', 'aria-hidden': 'true' }, '👑'),
      el('div', { class: 'row-avatar', 'aria-hidden': 'true' }, art ?? robot(index)),
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-head' }, [
          el('div', { class: 'row-name' }, [el('h3', { title: label }, shortLabel(label)), bubbles[0]]),
          ...(meter ? [meter] : []),
        ]),
        el('div', { class: 'row-guesses' }, bubbles.slice(1)),
      ]),
      el('div', { class: 'row-side' }, [this.timeEl, this.winsEl, score]),
    ]);
  }

  setThinking(on: boolean) {
    this.el.classList.toggle('thinking', on);
  }

  /** Won this round: crown, its color, the time it took, and the new win count. */
  win(score: number, seconds: number | null) {
    this.el.classList.add('won');
    this.timeEl.textContent = seconds === null ? '' : `${seconds.toFixed(1)}s`;
    this.winsEl.textContent = `${score} win${score === 1 ? '' : 's'}`;
  }

  /** New round: back to a plain row (the win count stays). */
  reset() {
    this.el.classList.remove('won', 'shrug');
    this.timeEl.textContent = '';
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
