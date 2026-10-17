/**
 * "Doodle Climb": each robot climbs its own ladder, one rung per round it wins (10 rounds, 10 rungs).
 * The player gets a row of stars. Display only; no game logic here.
 */

import { doodlerBot, replay, robot, you } from './art';
import { el } from './dom';
import { ROUNDS } from './words';

const RUNGS = 10;

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

/** One robot's box: its guesses, and a ladder it climbs one rung per round won. */
export class Lane {
  readonly el: HTMLElement;
  private climbing = el('div', { class: 'climber' });
  private level = 0;
  /** One star per rung, bottom rung first; lit for each round won. */
  private rungStars: HTMLElement[] = [];

  /** bubbles: the badge and guess feed shown above the ladder. */
  /** art: the climber (defaults to robot i); you() when You are guessing in bot-doodler mode. */
  constructor(index: number, label: string, bubbles: Node[], score: HTMLElement, meter?: Node, art?: Element) {
    this.climbing.append(art ?? robot(index));
    const rungs = el('div', { class: 'rungs' });
    for (let i = 0; i < RUNGS; i++) {
      const star = el('span', { class: 'rung-star', 'aria-hidden': 'true' }, '★');
      this.rungStars.unshift(star); // rungs are laid out top to bottom
      rungs.append(el('span', { class: 'rung' }, star));
    }
    this.el = el('div', { class: art ? 'lane card human' : `lane card p${index}` }, [
      el('div', { class: 'lane-head' }, [el('h3', { title: label }, label), score]),
      ...(meter ? [meter] : []),
      el('div', { class: 'thoughts' }, bubbles),
      el('div', { class: 'ladder' }, [el('span', { class: 'bell', 'aria-hidden': 'true' }, '🔔'), rungs, this.climbing]),
    ]);
  }

  private climbTo(rung: number) {
    const prev = this.level;
    this.level = Math.max(0, Math.min(RUNGS, rung));
    this.el.style.setProperty('--climb', String(this.level / RUNGS));
    if (this.level === prev) return;
    this.el.classList.remove('up', 'down');
    replay(this.el, this.level > prev ? 'up' : 'down');
  }

  setThinking(on: boolean) {
    this.el.classList.toggle('thinking', on);
  }

  /** Won a round: climb to the rung for the new score and ring the bell. */
  win(score: number) {
    this.climbTo(score);
    this.rungStars.forEach((s, i) => {
      s.classList.toggle('on', i < score);
      if (i === score - 1) replay(s, 'pop');
    });
    replay(this.el, 'rang');
  }

  /** New round: stop any celebration, stay on the current rung. */
  reset() {
    this.el.classList.remove('rang', 'shrug', 'up', 'down');
  }

  shrug() {
    replay(this.el, 'shrug');
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

/** Bot-doodler mode: the doodler's name and token meter under the lanes (its stars are beside the canvas). */
export function doodlerRow(label: string, meter: HTMLElement): HTMLElement {
  return el('div', { class: 'you-row doodler-row card' }, [
    doodlerBot(),
    el('div', { class: 'doodler-name' }, [el('h3', { title: label }, `✏️ ${label}`), meter]),
  ]);
}
