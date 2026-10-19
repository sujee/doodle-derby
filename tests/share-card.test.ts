import { describe, expect, it } from 'vitest';
import { chipOrder, speedTier } from '../src/share';

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
