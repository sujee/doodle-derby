/**
 * Stars: the doodler's column of stars beside the canvas, one per drawing guessed, and the doodler bot's
 * row in bot-doodler mode. (The guessers are rows in the field: field.ts.) Display only; no game logic here.
 */

import { doodlerBot, replay, you } from './art';
import { el } from './dom';
import { ROUNDS } from './words';


/** A row of ROUNDS stars; fill(n) lights up the first n. */
export class Stars {
  readonly el = el('div', { class: 'stars', 'aria-hidden': 'true' });
  private lit = 0;

  constructor() {
    for (let i = 0; i < ROUNDS; i++) this.el.append(el('span', { class: 'star' }, '★'));
  }

  fill(n: number) {
    [...this.el.children].forEach((s, i) => {
      s.classList.toggle('on', i < n);
      if (i >= this.lit && i < n) replay(s, 'pop');
    });
    this.lit = n;
  }
}

/**
 * The doodler's score beside the canvas: a face over a column of stars that fill from the bottom.
 * That's You normally, or the doodler bot in bot-doodler mode.
 */
export function starColumn(score: HTMLElement, stars: Stars, bot: boolean): HTMLElement {
  stars.el.classList.add('vertical');
  return el('div', { class: `star-col${bot ? ' doodler' : ''}`, title: bot ? 'Doodler’s stars: drawings guessed' : 'Your stars: drawings guessed' }, [
    bot ? doodlerBot() : you(),
    el('span', { class: 'star-col-name' }, bot ? 'Doodler' : 'You'),
    stars.el,
    score,
  ]);
}

/** Bot-doodler mode: the doodler's name and token meter under the field (its stars are beside the canvas). */
export function doodlerRow(label: string, meter: HTMLElement): HTMLElement {
  return el('div', { class: 'you-row doodler-row card' }, [
    doodlerBot(),
    el('div', { class: 'doodler-name' }, [el('h3', { title: label }, `✏️ ${label}`), meter]),
  ]);
}
