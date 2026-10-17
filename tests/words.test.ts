import { describe, expect, it } from 'vitest';
import { normalize } from '../src/match';
import { ALL_WORDS, pickWords, ROUNDS, tierForRound, WORDS } from '../src/words';

describe('tiers', () => {
  it('rounds 1–3 are easy, 4–7 medium, 8–10 hard', () => {
    expect(Array.from({ length: ROUNDS }, (_, i) => tierForRound(i))).toEqual([
      'easy', 'easy', 'easy', 'medium', 'medium', 'medium', 'medium', 'hard', 'hard', 'hard',
    ]);
  });
});

describe('pickWords', () => {
  it('picks 10 different words, each from its round’s tier', () => {
    for (let run = 0; run < 25; run++) {
      const words = pickWords();
      expect(words).toHaveLength(ROUNDS);
      expect(new Set(words.map((w) => w.word)).size).toBe(ROUNDS);
      words.forEach((w, i) => expect(WORDS[tierForRound(i)]).toContain(w));
    }
  });

  it('does not change the word lists', () => {
    const before = JSON.stringify(WORDS);
    pickWords();
    expect(JSON.stringify(WORDS)).toBe(before);
  });
});

describe('word lists', () => {
  it('have enough words per tier for a game', () => {
    expect(WORDS.easy.length).toBeGreaterThanOrEqual(3);
    expect(WORDS.medium.length).toBeGreaterThanOrEqual(4);
    expect(WORDS.hard.length).toBeGreaterThanOrEqual(3);
  });

  it('have no duplicate words across tiers', () => {
    expect(new Set(ALL_WORDS).size).toBe(ALL_WORDS.length);
  });

  it('every word and alternative survives normalizing (so it can be matched)', () => {
    for (const w of Object.values(WORDS).flat()) {
      expect(normalize(w.word), w.word).not.toBe('');
      for (const alt of w.alts ?? []) expect(normalize(alt), alt).not.toBe('');
    }
  });
});
