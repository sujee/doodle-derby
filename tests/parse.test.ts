import { describe, expect, it } from 'vitest';
import { cleanGuess, errorFromStatus, GuessError, parseGuess, PROMPT, promptFor } from '../src/providers/types';

describe('parseGuess: "<object> | <confidence>"', () => {
  it.each([
    ['cat | 70', { guess: 'cat', confidence: 70 }],
    ['ice cream | 85%', { guess: 'ice cream', confidence: 85 }],
    ['"Bicycle" | 40.6', { guess: 'Bicycle', confidence: 41 }],
    ['dog | 150', { guess: 'dog', confidence: 100 }],
    ['dog | -5', { guess: 'dog', confidence: 0 }],
    ['dog | very sure', { guess: 'dog', confidence: null }],
    ['just a guess', { guess: 'just a guess', confidence: null }],
    ['a | b | 30', { guess: 'a | b', confidence: 30 }],
    ['sun | 90\nBecause it is round and yellow.', { guess: 'sun', confidence: 90 }],
  ])('%j', (text, expected) => {
    expect(parseGuess(text)).toEqual(expected);
  });
});

describe('cleanGuess', () => {
  it('keeps the first line, without quotes, stars or a trailing period', () => {
    expect(cleanGuess('  "**Pizza**."  \nIt has toppings')).toBe('Pizza');
  });
  it('caps very long answers', () => {
    expect(cleanGuess('x'.repeat(200))).toHaveLength(60);
  });
});

describe('promptFor', () => {
  it('asks for "object | confidence"', () => {
    expect(PROMPT).toMatch(/confident/);
    expect(promptFor([])).toBe(PROMPT);
  });
  it('lists earlier wrong guesses so the bot does not repeat them', () => {
    expect(promptFor(['dog', 'cow'])).toMatch(/already wrong.*dog, cow/);
  });
});

describe('errorFromStatus', () => {
  it.each([
    [429, 'rate_limit'],
    [401, 'auth'],
    [403, 'auth'],
    [400, 'bad_request'],
    [404, 'bad_request'],
    [422, 'bad_request'],
    [500, 'other'],
    [503, 'other'],
  ])('HTTP %i → %s', (status, kind) => {
    const e = errorFromStatus(status, 'msg');
    expect(e).toBeInstanceOf(GuessError);
    expect(e.kind).toBe(kind);
  });

  it('passes on the Retry-After seconds', () => {
    expect(errorFromStatus(429, '', '12').retryAfter).toBe(12);
    expect(errorFromStatus(429, '', 'soon').retryAfter).toBeUndefined();
  });
});
