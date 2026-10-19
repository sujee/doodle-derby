import { describe, expect, it } from 'vitest';
import { brainLayout, chipOrder, speedTier } from '../src/share';

describe('the doodle card’s score chips', () => {
  it('put the bot with the most wins first, and keep ties in their original order', () => {
    expect(chipOrder([0, 0, 0, 1, 0, 3, 0])).toEqual([5, 3, 0, 1, 2, 4, 6]);
    expect(chipOrder([2, 2, 2])).toEqual([0, 1, 2]);
    expect(chipOrder([])).toEqual([]);
  });
});

describe('the tint of a guess time', () => {
  it('is fast up to 5 s, mid up to 15 s, then slow (a round is 30 s)', () => {
    expect(speedTier(1.2)).toBe('fast');
    expect(speedTier(5)).toBe('fast');
    expect(speedTier(5.5)).toBe('mid');
    expect(speedTier(15)).toBe('mid');
    expect(speedTier(15.1)).toBe('slow');
    expect(speedTier(29.9)).toBe('slow');
  });
});

describe('the bot brains pages', () => {
  it('fit five rounds a page with 7 bots, so a 10-round game is 2 pages', () => {
    const { pages } = brainLayout(10, 7);
    expect(pages).toEqual([[0, 1, 2, 3, 4], [5, 6, 7, 8, 9]]);
  });

  it('take fewer rounds a page as bots are added, spread evenly (4, 3, 3 rather than 4, 4, 2)', () => {
    expect(brainLayout(10, 8).pages.map((p) => p.length)).toEqual([4, 3, 3]);
    expect(brainLayout(10, 12).pages.length).toBeGreaterThan(3);
  });

  it('put every round on exactly one page, in order', () => {
    for (const [rounds, bots] of [[10, 3], [7, 7], [9, 8], [1, 4], [10, 1]]) {
      const { pages } = brainLayout(rounds, bots);
      expect(pages.flat()).toEqual(Array.from({ length: rounds }, (_, i) => i));
      const sizes = pages.map((p) => p.length);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    }
  });

  it('still make one (empty) page for a game with no rounds', () => {
    expect(brainLayout(0, 3).pages).toEqual([[]]);
  });

  it('put a whole 10-round game on one page with up to 3 bots, and keep a block tall enough for its doodle', () => {
    expect(brainLayout(10, 3).pages).toHaveLength(1);
    expect(brainLayout(10, 1).pages).toHaveLength(1);
    expect(brainLayout(10, 4).pages).toHaveLength(2);
    expect(brainLayout(10, 1).blockH).toBeGreaterThanOrEqual(80);
  });
});
