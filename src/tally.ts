import { el } from './dom';
import type { GameResult } from './engine';
import { costOf, formatTokens, formatUsd } from './pricing';

/**
 * The final tally: one row per guesser, best standing first, with their right guesses, all guesses
 * they made, API calls, tokens and cost — then a Totals row summing every column. The table is
 * fixed-layout and wraps the model names, so it fits the page instead of scrolling sideways.
 */
export function tallyTable(r: GameResult) {
  // Standing: ties share a place (1, 1, 3 …).
  const ranks = r.scores.map((s) => r.scores.filter((o) => o > s).length + 1);
  const order = r.labels.map((_, i) => i).sort((a, b) => r.scores[b] - r.scores[a] || a - b);
  // Guesses made: the distinct wrong ones each round, plus the round they got right.
  const guesses = r.labels.map((_, i) =>
    r.rounds.reduce((n, round) => n + round.guesses[i].length + (round.winner === i ? 1 : 0), 0),
  );
  const costs = r.usage.map((u, i) => costOf(u, r.prices[i]));
  const money = (i: number) =>
    r.prices[i].kind === 'free' ? 'free' : costs[i] === null ? 'price ?' : formatUsd(costs[i]);
  const total = costs.reduce<number>((a, c) => a + (c ?? 0), 0);
  const priced = r.prices.some((p) => p.kind === 'priced');
  const sum = (pick: (i: number) => number) => r.labels.reduce((n, _, i) => n + pick(i), 0);
  // Headers with a short form for narrow screens, where the long words would overlap.
  const head: (string | [string, string])[] = [
    ['Standing', '#'],
    'Model',
    ['Correct', 'Right'],
    ['Guesses', 'Tries'],
    'API calls',
    'Tokens in',
    'Tokens out',
    'Cost',
  ];
  return el('div', { class: 'tally-wrap' }, [
    el('table', { class: 'tally' }, [
      el('colgroup', {}, ['rank', 'model', ...Array(6).fill('num')].map((kind) => el('col', { class: `col-${kind}` }))),
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          head.map((h) =>
            el('th', {}, typeof h === 'string' ? h : [el('span', { class: 'wide' }, h[0]), el('span', { class: 'narrow' }, h[1])]),
          ),
        ),
      ),
      el(
        'tbody',
        {},
        order.map((i) =>
          el('tr', { class: i === r.humanIndex ? 'human' : '' }, [
            el('td', { class: 'rank' }, String(ranks[i])),
            el('td', { class: 'model' }, r.labels[i]),
            el('td', {}, String(r.scores[i])),
            el('td', {}, String(guesses[i])),
            el('td', {}, String(r.usage[i].calls)),
            el('td', {}, formatTokens(r.usage[i].input)),
            el('td', {}, formatTokens(r.usage[i].output)),
            el('td', {}, money(i)),
          ]),
        ),
      ),
      el(
        'tfoot',
        {},
        el('tr', {}, [
          el('td', { class: 'rank' }),
          el('td', { class: 'model' }, 'Totals'),
          el('td', {}, String(sum((i) => r.scores[i]))),
          el('td', {}, String(sum((i) => guesses[i]))),
          el('td', {}, String(sum((i) => r.usage[i].calls))),
          el('td', {}, formatTokens(sum((i) => r.usage[i].input))),
          el('td', {}, formatTokens(sum((i) => r.usage[i].output))),
          el('td', {}, priced ? formatUsd(total) : 'free'),
        ]),
      ),
    ]),
  ]);
}
