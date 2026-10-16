import { ALL_WORDS, type Word } from '../words';
import type { Guesser, GuessRequest, GuessResult } from './types';

export type FakeContext = {
  /** The word being drawn. Only the fake guesser gets to peek. */
  target: () => Word;
  /** 0..1: how far into the round we are. */
  progress: () => number;
  /** 0 = easy, 1 = medium, 2 = hard. */
  difficulty: () => number;
};

/** Simulated guesser for trying the game without an API key. */
export class FakeGuesser implements Guesser {
  readonly label = 'Fake guesser';

  constructor(private ctx: FakeContext) {}

  async guess({ wrongGuesses, signal }: GuessRequest): Promise<GuessResult> {
    await sleep(600 + Math.random() * 1400, signal);
    const progress = this.ctx.progress();
    const chance = Math.min(0.9, 0.08 + progress * 0.6 - this.ctx.difficulty() * 0.05);
    // Confidence grows with the round, plus noise; higher when it's about to be right.
    const confidence = (right: boolean) =>
      Math.round(Math.min(100, Math.max(0, 15 + progress * 55 + (right ? 25 : 0) + (Math.random() - 0.5) * 30)));
    if (Math.random() < chance) return { guess: this.ctx.target().word, confidence: confidence(true) };
    const target = this.ctx.target().word;
    const options = ALL_WORDS.filter((w) => w !== target && !wrongGuesses.includes(w));
    return { guess: options[Math.floor(Math.random() * options.length)], confidence: confidence(false) };
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
}
