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

/**
 * Status, mid-game: the same tally as the results screen, for the game so far, in a modal. Share
 * opens the share cards once a round is done. onClose runs when it closes (the game resumes).
 */
export function openStatusDialog(r: GameResult, title: string, onShare: (() => void) | null, onClose?: () => void) {
  const close = el('button', { type: 'button', class: 'icon-btn share-close', 'aria-label': 'Close' }, '✕');
  const share = el('button', { type: 'button', class: 'primary' }, 'Share…');
  const dialog = el('div', { class: 'share-dialog status-dialog card', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
    close,
    el('h2', {}, title),
    tallyTable(r),
    ...(onShare ? [el('div', { class: 'share-actions' }, share)] : []),
  ]);
  const backdrop = el('div', { class: 'share-backdrop' }, dialog);
  const dismiss = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && dismiss();
  close.addEventListener('click', dismiss);
  backdrop.addEventListener('click', (e) => e.target === backdrop && dismiss());
  share.addEventListener('click', () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    onShare?.(); // the share dialog takes over, and resumes the game when it closes
  });
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  close.focus();
}
