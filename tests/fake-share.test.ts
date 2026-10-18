import { describe, expect, it, vi } from 'vitest';
import type { GameResult } from '../src/engine';
import { FakeGuesser } from '../src/providers/fake';
import { headlineFor, shareText, shortName } from '../src/share';
import { ALL_WORDS } from '../src/words';

describe('fake guesser', () => {
  const ctx = (progress: number) => ({ target: () => ({ word: 'cat' }), progress: () => progress, difficulty: () => 0 });
  const ask = async (g: FakeGuesser, wrongGuesses: string[] = []) => {
    const p = g.guess({ image: '', wrongGuesses, signal: new AbortController().signal });
    await vi.advanceTimersByTimeAsync(3000);
    return p;
  };

  it('guesses right when luck says so, with higher confidence late in the round', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const r = await ask(new FakeGuesser(ctx(1)));
    expect(r.guess).toBe('cat');
    expect(r.confidence).toBeGreaterThan(50);
  });

  it('otherwise guesses another real word it hasn’t tried yet', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const r = await ask(new FakeGuesser(ctx(0)), ['zebra']);
    expect(r.guess).not.toBe('cat');
    expect(ALL_WORDS).toContain(r.guess);
  });

  it('takes 0.6–2 s to answer and can be cancelled', async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const p = new FakeGuesser(ctx(0)).guess({ image: '', wrongGuesses: [], signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});

const game = (over: Partial<GameResult> = {}): GameResult => ({
  labels: ['claude-sonnet-5-5', 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8'],
  usage: [],
  prices: [],
  scores: [3, 1],
  playerScore: 4,
  stopped: true, // two rounds, then Stop: a finished game

  rounds: [
    { word: 'hat', winner: 0, seconds: 4, guesses: [['bowl'], ['a very sad cat']], image: null },
    { word: 'sun', winner: null, seconds: null, guesses: [['orange'], []], image: null },
  ],
  ...over,
});

describe('share text', () => {
  it('headline names the winner, or a tie, or nobody', () => {
    expect(headlineFor(game())).toBe('claude-sonnet-5-5 wins!');
    expect(headlineFor(game({ scores: [2, 2] }))).toBe("It's a tie!");
    expect(headlineFor(game({ scores: [0, 0] }))).toBe('The bots were stumped!');
    expect(headlineFor(game({ rounds: [] }))).toBe('Game stopped');
    expect(headlineFor(game({ stopped: false }))).toBe('claude-sonnet-5-5 leads!'); // shared mid-game
    expect(headlineFor(game({ stopped: false, scores: [2, 2] }))).toBe('Neck and neck!');
    expect(headlineFor(game({ labels: ['bot', 'You'], scores: [1, 3], humanIndex: 1, doodler: { label: 'P', usage: { input: 0, output: 0, calls: 0 }, price: { kind: 'unknown' } } }))).toBe('You win!');
  });

  it('shortName drops the provider prefix and trims long names', () => {
    expect(shortName('meta-llama/Llama-4-Maverick')).toBe('Llama-4-Maverick');
    expect(shortName('a'.repeat(40), 10)).toBe(`${'a'.repeat(9)}…`);
  });

  it('share text tells the story, with no link when playing locally', () => {
    const text = shareText(game());
    expect(text).toMatch(/Doodle Duel/);
    expect(text).toMatch(/4 of my 2 doodles|guessed 4 of my 2/);
    expect(text).not.toMatch(/Wildest/);
    expect(text).not.toMatch(/localhost/);
  });
});
