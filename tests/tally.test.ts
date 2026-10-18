import { describe, expect, it } from 'vitest';
import type { GameResult } from '../src/engine';
import { tallyTable } from '../src/tally';

// The end-of-game tally: rows best-first, then a Totals row across every column.

const result: GameResult = {
  labels: ['moonshotai/Kimi-K3', 'nvidia/Nemotron-3-Super-120B-A12B', 'You'],
  usage: [
    { input: 73_000, output: 1_700, calls: 152 },
    { input: 35_000, output: 2_900, calls: 102 },
    { input: 0, output: 0, calls: 0 },
  ],
  prices: [
    { kind: 'priced', in: 1, out: 2 },
    { kind: 'priced', in: 1, out: 2 },
    { kind: 'free', why: 'you type the guesses' },
  ],
  scores: [5, 1, 5],
  playerScore: 10,
  rounds: [
    { word: 'cat', winner: 0, seconds: 3.2, guesses: [['dog'], ['bird'], []], image: null },
    { word: 'dog', winner: 2, seconds: 5.1, guesses: [['fish'], ['cat'], ['tree']], image: null },
  ],
  stopped: false,
  humanIndex: 2,
};

const text = (node: Element) => node.textContent;

describe('the winning tally', () => {
  it('has no title line (the totals row carries the cost)', () => {
    expect(tallyTable(result).querySelector('caption')).toBeNull();
  });

  it('shows the full model name, not a cut-off one', () => {
    const models = [...tallyTable(result).querySelectorAll('tbody td.model')].map(text);
    expect(models).toContain('nvidia/Nemotron-3-Super-120B-A12B');
  });

  it('ends with a Totals row summing every column', () => {
    const cells = [...tallyTable(result).querySelectorAll('tfoot tr > *')].map(text);
    expect(cells).toEqual([
      '',
      'Totals',
      '11', // right guesses: 5 + 1 + 5
      '7', // guesses made: 3 + 2 + 2
      '254', // API calls: 152 + 102 + 0
      '108k', // tokens in: 73k + 35k
      '4.6k', // tokens out: 1.7k + 2.9k
      '$0.117', // cost: 0.0764 + 0.0408 + free
    ]);
  });
});
