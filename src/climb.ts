/**
 * The doodler bot's row in bot-doodler mode. (The guessers are rows in the field: field.ts.)
 * Display only; no game logic here.
 */

import { doodlerBot } from './art';
import { el } from './dom';


/** Bot-doodler mode: the doodler's name and token meter under the field (its score is the badge on the paper). */
export function doodlerRow(label: string, meter: HTMLElement): HTMLElement {
  return el('div', { class: 'you-row doodler-row card' }, [
    doodlerBot(),
    el('div', { class: 'doodler-name' }, [el('h3', { title: label }, `✏️ ${label}`), meter]),
  ]);
}
