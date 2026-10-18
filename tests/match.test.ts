import { describe, expect, it } from 'vitest';
import { isMatch, normalize } from '../src/match';

describe('normalize', () => {
  it.each([
    ['A Cat!', 'cat'],
    ['  The   Sun ', 'sun'],
    ['some apples', 'apple'],
    ['Hot-Air Balloon', 'hot air balloon'],
    ['butterflies', 'butterfly'],
    ['boxes', 'box'],
    ['glasses', 'glasses'],
    ['scissors', 'scissors'],
    ['grass', 'grass'],
    ['bus', 'bus'], // short words are left alone
    ['123 !!', ''],
  ])('%j → %j', (input, expected) => {
    expect(normalize(input)).toBe(expected);
  });
});

describe('isMatch', () => {
  const cat = { word: 'cat', alts: ['kitten', 'kitty'] };

  it('accepts the word, its alternatives, and plural or article variations', () => {
    for (const guess of ['cat', 'Cat.', 'cats', 'a cat', 'kitten', 'Kittens!', 'kitty']) expect(isMatch(guess, cat), guess).toBe(true);
  });

  it('accepts the answer as the last word(s): "red ball", "top hat"', () => {
    expect(isMatch('a red ball', { word: 'ball' })).toBe(true);
    expect(isMatch('top hat', { word: 'hat' })).toBe(true);
    expect(isMatch('my hot air balloon', { word: 'hot air balloon' })).toBe(true);
  });

  it('rejects words that only contain the answer', () => {
    expect(isMatch('basketball', { word: 'ball' })).toBe(false);
    expect(isMatch('hatch', { word: 'hat' })).toBe(false);
    expect(isMatch('cat food', cat)).toBe(false); // the answer must be the end
  });

  it('rejects empty or punctuation-only guesses', () => {
    expect(isMatch('', cat)).toBe(false);
    expect(isMatch('???', cat)).toBe(false);
  });
});
