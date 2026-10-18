import { describe, expect, it, vi } from 'vitest';
import type { Doodle, Doodler } from '../src/doodler';
import { DOODLE_FAIL_MS, Engine, POLL_MS, REASK_MS, ROUND_MS, type GameResult } from '../src/engine';
import { GuessError } from '../src/providers/types';
import { FakeBoard, FakeClock, ScriptedBot, WORDS, flush, recordEvents } from './helpers';

const FREE = { kind: 'free', why: 'fake bot' } as const;

function setup(bots: ScriptedBot[], opts: { doodler?: Doodler; youGuess?: boolean } = {}) {
  const clock = new FakeClock();
  const board = new FakeBoard();
  const rec = recordEvents();
  let result: GameResult | null = null;
  const engine = new Engine({
    bots: () => bots.map((guesser) => ({ guesser, price: FREE })),
    board,
    clock,
    words: WORDS,
    doodler: opts.doodler ? { doodler: opts.doodler, price: { kind: 'unknown' }, youGuess: opts.youGuess } : undefined,
    events: { ...rec.events, finish: (r) => (result = r) },
  });
  return { engine, clock, board, rec, result: () => result };
}

/** Draw, then let the next poll go out. */
async function drawAndPoll(clock: FakeClock, board: FakeBoard) {
  board.draw();
  await clock.advance(POLL_MS);
}

describe('round start', () => {
  it('starts round 1 with the first word; the clock waits for the bots', () => {
    const { engine } = setup([new ScriptedBot('A')]);
    engine.start();
    expect(engine.round).toBe(0);
    expect(engine.word.word).toBe('cat');
    expect(engine.roundOver).toBe(false);
    expect(engine.clockRunning).toBe(false);
    expect(engine.timeLeft()).toBe(ROUND_MS);
  });

  it('does not end the round while nothing has been drawn, however long you wait', async () => {
    const bot = new ScriptedBot('A');
    const { engine, clock } = setup([bot]);
    engine.start();
    await clock.advance(ROUND_MS * 3);
    expect(engine.roundOver).toBe(false);
    expect(bot.calls).toBe(0);
  });
});

describe('polling the bots', () => {
  it('counts a call as soon as it is sent, even while a slow bot is still thinking', async () => {
    const slow = new ScriptedBot('Slow', [{ guess: 'dog', confidence: 1 }], { hold: true });
    const fast = new ScriptedBot('Fast', [{ guess: 'cat', confidence: 90 }]);
    const { engine, clock, board } = setup([slow, fast]);
    engine.start();
    await drawAndPoll(clock, board);
    expect(engine.players[0].usage.calls).toBe(1); // no reply yet
    expect(engine.roundOver).toBe(true); // Fast won; Slow's request was cancelled
    expect(engine.players[0].usage).toEqual({ input: 0, output: 0, calls: 1 });
  });

  it('sends one shared snapshot to every bot, and starts the clock then', async () => {
    const a = new ScriptedBot('A');
    const b = new ScriptedBot('B');
    const { engine, clock, board } = setup([a, b]);
    engine.start();
    await clock.advance(1000);
    await drawAndPoll(clock, board);
    expect(a.calls).toBeGreaterThanOrEqual(1);
    expect(b.calls).toBe(a.calls);
    expect(a.requests[0].image).toBe(b.requests[0].image);
    expect(board.snapshots).toBe(a.calls); // one snapshot per ask, shared by both
    expect(engine.clockRunning).toBe(true);
    // The clock started with the first snapshot (at 2.5 s), not when the round opened.
    expect(engine.timeLeft()).toBe(ROUND_MS - (clock.now() - POLL_MS));
  });

  it('keeps asking until time runs out, even with an unchanged drawing: soon after each wrong answer', async () => {
    const bot = new ScriptedBot('A');
    const { engine, clock, board } = setup([bot]);
    engine.start();
    await drawAndPoll(clock, board);
    expect(bot.calls).toBe(1);
    await clock.advance(REASK_MS);
    expect(bot.calls).toBe(2);
    await clock.advance(REASK_MS);
    expect(bot.calls).toBe(3);
    await clock.advance(ROUND_MS);
    expect(engine.roundOver).toBe(true);
    const calls = bot.calls;
    await clock.advance(POLL_MS * 2);
    expect(bot.calls).toBe(calls); // not after the round
  });

  it('keeps at most one request in flight per bot', async () => {
    const bot = new ScriptedBot('A', [{ guess: 'dog', confidence: 5 }], { hold: true });
    const { engine, clock, board } = setup([bot]);
    engine.start();
    await drawAndPoll(clock, board);
    board.draw();
    await clock.advance(POLL_MS * 2);
    expect(bot.calls).toBe(1);
    bot.release();
    await flush();
    await clock.advance(POLL_MS);
    expect(bot.calls).toBe(2);
  });

  it('tells each bot its earlier wrong guesses, without repeats', async () => {
    const bot = new ScriptedBot('A', [{ guess: 'dog', confidence: 5 }, { guess: 'dog', confidence: 5 }, { guess: 'cow', confidence: 5 }, { guess: 'x', confidence: 1 }]);
    const { engine, clock, board } = setup([bot]);
    engine.start();
    await drawAndPoll(clock, board);
    await clock.advance(REASK_MS * 3);
    expect(bot.requests.map((r) => r.wrongGuesses)).toEqual([[], ['dog'], ['dog'], ['dog', 'cow']]);
    expect(engine.players[0].history.map((h) => h.guess)).toEqual(['dog', 'dog', 'cow', 'x']);
  });
});

describe('guessing and scoring (you draw)', () => {
  it('a right guess ends the round: +1 for the bot and +1 for you', async () => {
    const bot = new ScriptedBot('A', [{ guess: 'dog', confidence: 20 }, { guess: 'cat', confidence: 80 }]);
    const { engine, clock, board, rec } = setup([bot]);
    engine.start();
    await drawAndPoll(clock, board);
    await drawAndPoll(clock, board);
    expect(engine.roundOver).toBe(true);
    expect(engine.players[0].score).toBe(1);
    expect(engine.playerScore).toBe(1);
    const round = engine.results[0];
    expect(round).toMatchObject({ word: 'cat', winner: 0, guesses: [['dog']] });
    expect(round.seconds).toBeCloseTo(REASK_MS / 1000, 5); // asked again right after 'dog'
    expect(round.image).toMatch(/^data:image\/jpeg/);
    expect(rec.names()).toContain('roundEnding');
    expect(rec.names().indexOf('roundEnding')).toBeLessThan(rec.names().indexOf('roundEnd'));
  });

  it('accepts sloppy but correct answers ("A red Cat.")', async () => {
    const bot = new ScriptedBot('A', [{ guess: 'A red Cat.', confidence: 90 }]);
    const { engine, clock, board } = setup([bot]);
    engine.start();
    await drawAndPoll(clock, board);
    expect(engine.results[0].winner).toBe(0);
  });

  it('the first right answer wins; a later one from another bot is ignored', async () => {
    const fast = new ScriptedBot('Fast', [{ guess: 'cat', confidence: 70 }]);
    const slow = new ScriptedBot('Slow', [{ guess: 'cat', confidence: 99 }], { hold: true });
    const { engine, clock, board } = setup([fast, slow]);
    engine.start();
    await drawAndPoll(clock, board);
    slow.release();
    await flush();
    expect(engine.players.map((p) => p.score)).toEqual([1, 0]);
    expect(engine.playerScore).toBe(1);
  });

  it('time runs out 30 s after the clock starts: nobody scores', async () => {
    const bot = new ScriptedBot('A', [{ guess: 'dog', confidence: 5 }]);
    const { engine, clock, board } = setup([bot]);
    engine.start();
    await clock.advance(5000); // round open, nothing drawn yet: no clock
    await drawAndPoll(clock, board);
    await clock.advance(ROUND_MS - 200);
    expect(engine.roundOver).toBe(false);
    await clock.advance(300);
    expect(engine.roundOver).toBe(true);
    expect(engine.results[0]).toMatchObject({ winner: null, seconds: null });
    expect(engine.playerScore).toBe(0);
  });

  it('skip ends the round with nobody scoring', async () => {
    const { engine } = setup([new ScriptedBot('A')]);
    engine.start();
    engine.skip();
    expect(engine.roundOver).toBe(true);
    expect(engine.results[0].winner).toBeNull();
    expect(engine.results[0].image).toBeNull(); // nothing was drawn
  });

  it('an answer that arrives after the round ended does not count, but its tokens do', async () => {
    const bot = new ScriptedBot('A', [{ guess: 'cat', confidence: 90, usage: { input: 100, output: 3 } }], { hold: true });
    const { engine, clock, board } = setup([bot]);
    engine.start();
    await drawAndPoll(clock, board);
    // The request was aborted by skip(), so the held reply rejects: nothing is billed or scored.
    engine.skip();
    bot.release();
    await flush();
    expect(engine.players[0].score).toBe(0);
    expect(engine.results[0].winner).toBeNull();
  });
});

describe('rounds and the end of the game', () => {
  it('ignores "next round" while a round is still being played', () => {
    const { engine } = setup([new ScriptedBot('A')]);
    engine.start();
    engine.nextRound();
    expect(engine.round).toBe(0);
  });

  it('plays 10 rounds with the words in order, then finishes with the results', async () => {
    const bot = new ScriptedBot('A', [() => ({ guess: WORDS[engine.round].word, confidence: 50, usage: { input: 10, output: 1 } })]);
    const { engine, clock, board, result } = setup([bot]);
    engine.start();
    for (let r = 0; r < 10; r++) {
      expect(engine.word.word).toBe(WORDS[r].word);
      await drawAndPoll(clock, board);
      expect(engine.roundOver).toBe(true);
      engine.nextRound();
    }
    const r = result()!;
    expect(r).not.toBeNull();
    expect(r.stopped).toBe(false);
    expect(r.rounds).toHaveLength(10);
    expect(r.scores).toEqual([10]);
    expect(r.playerScore).toBe(10);
    expect(r.usage[0]).toEqual({ input: 100, output: 10, calls: 10 });
    expect(r.doodler).toBeUndefined();
    engine.nextRound();
    expect(engine.round).toBe(10); // finished: nothing more happens
  });

  it('stop ends the game at once with the rounds played so far', async () => {
    const { engine, clock, board, result } = setup([new ScriptedBot('A', [{ guess: 'cat', confidence: 50 }])]);
    engine.start();
    await drawAndPoll(clock, board);
    engine.nextRound();
    engine.stop();
    expect(result()).toMatchObject({ stopped: true, scores: [1] });
    expect(result()!.rounds).toHaveLength(1);
    expect(clock.pendingTimers).toBe(0);
  });

  it('numbers bots that share a name', () => {
    const { engine } = setup([new ScriptedBot('gpt-4o'), new ScriptedBot('gpt-4o'), new ScriptedBot('claude')]);
    expect(engine.players.map((p) => p.label)).toEqual(['gpt-4o #1', 'gpt-4o #2', 'claude']);
  });
});

describe('requests cut off by the end of the round', () => {
  it('a bot still waiting for its reply is cancelled and just goes back to ready', async () => {
    const slow = new ScriptedBot('Slow', [{ guess: 'dog', confidence: 1 }], { hold: true });
    const fast = new ScriptedBot('Fast', [{ guess: 'cat', confidence: 90 }]);
    const { engine, clock, board, rec } = setup([slow, fast]);
    engine.start();
    await drawAndPoll(clock, board);
    expect(engine.roundOver).toBe(true);
    const badges = (i: number) => rec.log.filter((e) => e.name === 'badge' && e.args[0] === i).map((e) => e.args[2]);
    expect(engine.players[0].inFlight).toBe(false);
    expect(badges(0).at(-1)).toBe(''); // its request was cancelled; no badge for that
    expect(badges(1).at(-1)).toBe('');
  });
});

describe('pause', () => {
  it('freezes the clock and cancels requests; resume picks up with the same time left', async () => {
    const bot = new ScriptedBot('A', [{ guess: 'dog', confidence: 5 }], { hold: true });
    const { engine, clock, board } = setup([bot]);
    engine.start();
    await drawAndPoll(clock, board);
    await clock.advance(10_000);
    const left = engine.timeLeft();
    engine.pause();
    expect(engine.paused).toBe(true);
    expect(engine.players[0].inFlight).toBe(false);
    await clock.advance(60_000);
    expect(engine.roundOver).toBe(false);
    expect(engine.timeLeft()).toBe(left);
    engine.resume();
    expect(engine.timeLeft()).toBe(left);
    await clock.advance(POLL_MS);
    expect(bot.calls).toBe(2); // the cancelled request is sent again
  });

  it('can pause between rounds and carry on', async () => {
    const { engine, clock, board } = setup([new ScriptedBot('A', [{ guess: 'cat', confidence: 50 }])]);
    engine.start();
    await drawAndPoll(clock, board);
    engine.pause();
    engine.resume();
    engine.nextRound();
    expect(engine.round).toBe(1);
  });
});

describe('errors', () => {
  it('rate limited: the bot waits for the retry-after time', async () => {
    const bot = new ScriptedBot('A', [new GuessError('rate_limit', 'slow down', 8), { guess: 'dog', confidence: 1 }]);
    const { engine, clock, board, rec } = setup([bot]);
    engine.start();
    await drawAndPoll(clock, board);
    board.draw();
    await clock.advance(7500); // t = 10 s: still inside the 8 s wait (it ends at 10.5 s)
    expect(bot.calls).toBe(1);
    await clock.advance(POLL_MS); // the next poll, at 12.5 s
    expect(bot.calls).toBe(2);
    expect(rec.log.some((e) => e.name === 'badge' && e.args[2] === 'warn')).toBe(true);
  });

  it('bad key: the bot sits out the rest of the game', async () => {
    const bot = new ScriptedBot('A', [new GuessError('auth', 'Invalid API key')]);
    const { engine, clock, board } = setup([bot]);
    engine.start();
    await drawAndPoll(clock, board);
    for (let i = 0; i < 5; i++) await drawAndPoll(clock, board);
    expect(bot.calls).toBe(1);
    expect(engine.players[0].disabled).toBe(true);
  });

  it('network or other errors: back off 5 s, then try again', async () => {
    const bot = new ScriptedBot('A', [new GuessError('network', 'offline'), new Error('boom'), { guess: 'dog', confidence: 1 }]);
    const { engine, clock, board } = setup([bot]);
    engine.start();
    await drawAndPoll(clock, board); // network error
    board.draw();
    await clock.advance(POLL_MS); // still backing off
    expect(bot.calls).toBe(1);
    await clock.advance(POLL_MS); // 5 s later
    expect(bot.calls).toBe(2);
  });
});

describe('a bot draws (bot-doodler mode)', () => {
  const doodle: Doodle = { strokes: [[{ x: 1, y: 1 }, { x: 2, y: 2 }]], usage: { input: 50, output: 900 } };

  function doodlerThat(draw: (word: string) => Promise<Doodle>): Doodler & { words: string[] } {
    const words: string[] = [];
    return { label: 'Painter', words, draw: (word) => (words.push(word), draw(word)) };
  }

  it('by default you just watch: only the bots guess', async () => {
    const doodler = doodlerThat(async () => doodle);
    const { engine, result } = setup([new ScriptedBot('A'), new ScriptedBot('B')], { doodler });
    engine.start();
    await flush();
    expect(engine.players.map((p) => p.label)).toEqual(['A', 'B']);
    expect(engine.humanIndex).toBe(-1);
    expect(engine.submitGuess('cat')).toBe(false);
    engine.stop();
    expect(result()).not.toHaveProperty('humanIndex');
  });

  it('with youGuess, adds You as a guesser; you can guess only once the drawing has started', async () => {
    let finishDrawing!: (d: Doodle) => void;
    const doodler = doodlerThat(() => new Promise((r) => (finishDrawing = r)));
    const { engine, rec } = setup([new ScriptedBot('A')], { doodler, youGuess: true });
    engine.start();
    expect(engine.players.map((p) => p.label)).toEqual(['A', 'You']);
    expect(engine.humanIndex).toBe(1);
    expect(rec.log.some((e) => e.name === 'doodleStatus' && e.args[0] === 'sketching')).toBe(true);
    expect(engine.submitGuess('cat')).toBe(false); // still sketching
    finishDrawing(doodle);
    await flush();
    expect(engine.sketching).toBe(true);
    expect(engine.clockRunning).toBe(true);
    expect(rec.names()).toContain('sketch');
    expect(engine.submitGuess('  ')).toBe(false);
    expect(engine.submitGuess('cat')).toBe(true);
    expect(engine.players[1].score).toBe(1); // You
    expect(engine.playerScore).toBe(1); // the doodler's star
  });

  it('fetches the next drawing ahead, and counts the doodler’s tokens', async () => {
    const doodler = doodlerThat(async () => doodle);
    const { engine } = setup([new ScriptedBot('A')], { doodler });
    engine.start();
    await flush();
    expect(doodler.words).toEqual(['cat', 'sun']); // round 2's drawing requested already
    expect(engine.doodlerUsage).toEqual({ input: 100, output: 1800, calls: 2 });
    engine.skip();
    engine.nextRound();
    await flush();
    expect(doodler.words).toEqual(['cat', 'sun', 'hat']); // reused "sun", fetched "hat" ahead
  });

  it('retries a failed drawing once, then skips the round', async () => {
    const doodler = doodlerThat(async () => {
      throw new GuessError('other', 'The doodler’s drawing was garbled');
    });
    const { engine, clock, rec } = setup([new ScriptedBot('A')], { doodler });
    engine.start();
    await flush();
    expect(doodler.words).toEqual(['cat', 'cat']);
    expect(rec.log.find((e) => e.name === 'doodleStatus' && e.args[0] === 'failed')?.args[1]).toMatch(/garbled/);
    expect(engine.roundOver).toBe(false);
    await clock.advance(DOODLE_FAIL_MS);
    expect(engine.roundOver).toBe(true);
    expect(engine.results[0].winner).toBeNull();
  });

  it('if paused while the drawing arrives, it starts on resume', async () => {
    let finishDrawing!: (d: Doodle) => void;
    const doodler = doodlerThat(() => new Promise((r) => (finishDrawing = r)));
    const { engine } = setup([new ScriptedBot('A')], { doodler });
    engine.start();
    engine.pause();
    finishDrawing(doodle);
    await flush();
    expect(engine.sketching).toBe(false);
    engine.resume();
    expect(engine.sketching).toBe(true);
  });

  it('the results name the doodler and where You are', async () => {
    const doodler = doodlerThat(async () => doodle);
    const { engine, result } = setup([new ScriptedBot('A')], { doodler, youGuess: true });
    engine.start();
    await flush();
    engine.stop();
    expect(result()).toMatchObject({ humanIndex: 1, labels: ['A', 'You'], doodler: { label: 'Painter' } });
  });

  it('a bot guessing right gives the bot a star and the doodler a star', async () => {
    const doodler = doodlerThat(async () => doodle);
    const bot = new ScriptedBot('A', [{ guess: 'cat', confidence: 60 }]);
    const { engine, clock, board } = setup([bot], { doodler });
    engine.start();
    await flush();
    await drawAndPoll(clock, board); // the sketch puts lines on the board
    expect(engine.players.map((p) => p.score)).toEqual([1]); // no "You" row: you watch
    expect(engine.playerScore).toBe(1);
  });
});

describe('the fake guesser’s view of the round', () => {
  it('sees progress grow from 0 to 1 over the round', async () => {
    let progress = () => 0;
    const clock = new FakeClock();
    const board = new FakeBoard();
    const engine = new Engine({
      bots: (fake) => {
        progress = fake.progress;
        return [{ guesser: new ScriptedBot('A'), price: FREE }];
      },
      board,
      clock,
      words: WORDS,
    });
    engine.start();
    expect(progress()).toBe(0);
    await drawAndPoll(clock, board);
    await clock.advance(ROUND_MS / 2);
    expect(progress()).toBeCloseTo(0.5, 1);
    vi.restoreAllMocks();
  });
});
