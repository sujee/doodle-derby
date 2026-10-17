/**
 * The game's rules, with no DOM: rounds and their clock, polling the bots with snapshots, guesses
 * and matching, scoring (both "you draw" and "a bot draws"), error backoff, pause / resume / stop,
 * the doodler's fetch-ahead and retry, and the final results.
 *
 * It talks to the outside world through three small seams, so tests can drive whole games:
 * - a Clock (time and timers),
 * - a Board (whatever holds the drawing: is it empty, has it changed, give me a snapshot),
 * - EngineEvents (what the screen should show).
 */

import type { Doodle, Doodler } from './doodler';
import { isMatch } from './match';
import type { Price, Usage } from './pricing';
import type { FakeContext } from './providers/fake';
import { GuessError, type Guesser } from './providers/types';
import { pickWords, ROUNDS, tierForRound, type Tier, type Word } from './words';

export const ROUND_MS = 30_000;
export const POLL_MS = 2_500;
export const TICK_MS = 100;
/** How long the "the doodler got stuck" message shows before the round is skipped. */
export const DOODLE_FAIL_MS = 2_500;
const TIERS: Tier[] = ['easy', 'medium', 'hard'];

export interface Clock {
  now(): number;
  setInterval(fn: () => void, ms: number): number;
  clearInterval(id: number): void;
  setTimeout(fn: () => void, ms: number): number;
}

export const realClock: Clock = {
  now: () => performance.now(),
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: (id) => window.clearInterval(id),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
};

/** The drawing surface, as far as the rules care. */
export interface Board {
  readonly isEmpty: boolean;
  /** Increments on every visible change. */
  readonly changeVersion: number;
  snapshot(): string;
}

export type GuessEntry = { guess: string; right: boolean; confidence: number | null; secs: string };

export type PlayerState = {
  label: string;
  /** You, guessing by typing (bot-doodler mode). Never polled. */
  human: boolean;
  score: number;
  /** Distinct wrong guesses this round (sent back to the bot so it doesn't repeat them). */
  wrong: string[];
  /** Every guess this round, oldest first. */
  history: GuessEntry[];
  inFlight: boolean;
  /** Board version this bot last saw, so an unchanged drawing isn't sent twice. */
  lastVersion: number;
  backoffUntil: number;
  /** Set after a bad key: the bot sits out the rest of the game. */
  disabled: boolean;
  usage: Usage;
  price: Price;
};

export type RoundResult = {
  word: string;
  winner: number | null;
  seconds: number | null;
  /** Each player's distinct wrong guesses. */
  guesses: string[][];
  /** JPEG data URL of the final drawing, or null if the board was empty. */
  image: string | null;
};

export type GameResult = {
  labels: string[];
  /** Tokens and calls per player (successful calls only; cancelled requests report nothing). */
  usage: Usage[];
  prices: Price[];
  scores: number[];
  playerScore: number;
  rounds: RoundResult[];
  stopped: boolean;
  /**
   * Set when a bot drew. Then playerScore is the doodler's score (drawings guessed), and "You" are
   * one of the guessers, at index humanIndex in labels/scores/usage/prices.
   */
  doodler?: { label: string; usage: Usage; price: Price };
  humanIndex?: number;
};

export type BadgeKind = '' | 'thinking' | 'warn' | 'error';

/** Everything the screen needs to hear about. All optional. */
export interface EngineEvents {
  roundStart?(round: number, word: Word, tier: Tier): void;
  /** Every TICK_MS while a round runs. */
  tick?(msLeft: number, clockRunning: boolean): void;
  /** A snapshot is going out to these players. */
  snapshot?(image: string, players: number[]): void;
  badge?(player: number, text: string, kind: BadgeKind, detail?: string): void;
  guess?(player: number, entry: GuessEntry): void;
  usage?(player: number): void;
  doodlerUsage?(): void;
  /** Bot-doodler mode: waiting for the drawing, or it failed (the round is skipped shortly). */
  doodleStatus?(status: 'sketching' | 'failed', message?: string): void;
  /** Bot-doodler mode: animate these strokes now; the round clock starts. */
  sketch?(doodle: Doodle): void;
  /** Just before the round's result is recorded: finish anything drawn, so the final snapshot is complete. */
  roundEnding?(): void;
  roundEnd?(result: RoundResult, round: number): void;
  pause?(paused: boolean): void;
  finish?(result: GameResult): void;
  log?(kind: 'game' | 'error', message: string, data?: unknown): void;
}

export type BotSpec = { guesser: Guesser; price: Price };

export type EngineOptions = {
  /** Builds the guesser bots; gets a FakeContext for the no-key fake guesser. */
  bots: (fake: FakeContext) => BotSpec[];
  board: Board;
  events?: EngineEvents;
  clock?: Clock;
  /** The 10 words to play (default: random, getting harder). */
  words?: Word[];
  /** Set when a bot draws instead of you. */
  doodler?: { doodler: Doodler; price: Price };
};

export class Engine {
  readonly players: PlayerState[];
  readonly words: Word[];
  readonly results: RoundResult[] = [];
  /** Your score, or the doodler bot's in bot-doodler mode: drawings that got guessed. */
  playerScore = 0;
  round = -1;
  roundOver = true;
  stopped = false;
  finished = false;
  clockRunning = false;

  private roundId = 0;
  private roundStart = 0;
  /** When the game was paused, or null when it isn't (0 is a valid time, so no 0 sentinel). */
  private pausedAt: number | null = null;
  private abort = new AbortController();
  private timers: number[] = [];
  private guessers: Guesser[];
  private board: Board;
  private events: EngineEvents;
  private clock: Clock;

  // Bot-doodler mode
  readonly doodler: Doodler | null;
  readonly doodlerPrice: Price;
  readonly doodlerUsage: Usage = { input: 0, output: 0, calls: 0 };
  private doodles = new Map<number, Promise<Doodle>>();
  private doodleAbort = new AbortController();
  /** True once this round's drawing has started (you may guess). */
  sketching = false;
  private pendingDoodle: Doodle | null = null;

  constructor(opts: EngineOptions) {
    this.board = opts.board;
    this.events = opts.events ?? {};
    this.clock = opts.clock ?? realClock;
    this.words = opts.words ?? pickWords();
    this.doodler = opts.doodler?.doodler ?? null;
    this.doodlerPrice = opts.doodler?.price ?? { kind: 'unknown' };

    const fake: FakeContext = {
      target: () => this.words[Math.max(0, this.round)],
      progress: () => this.progress(),
      difficulty: () => TIERS.indexOf(tierForRound(Math.max(0, this.round))),
    };
    const bots = opts.bots(fake);
    this.guessers = bots.map((b) => b.guesser);
    this.players = bots.map((b) => newPlayer(b.guesser.label, b.price));
    if (this.doodler) {
      // You join the guessers, after the bots.
      this.guessers.push({ label: 'You', guess: () => Promise.reject(new Error('You guess by typing')) });
      this.players.push({ ...newPlayer('You', { kind: 'free', why: 'you' }), human: true });
    }
    // Same model twice gets numbered labels so the scoreboard stays readable. Compare the original
    // names: renaming one bot must not hide that the next one is a duplicate too.
    const names = this.players.map((p) => p.label);
    this.players.forEach((p, i) => {
      if (!p.human && names.filter((n) => n === names[i]).length > 1) p.label = `${names[i]} #${i + 1}`;
    });
  }

  get word(): Word {
    return this.words[this.round];
  }

  get paused(): boolean {
    return this.pausedAt !== null;
  }

  get humanIndex(): number {
    return this.players.findIndex((p) => p.human);
  }

  /** ms left on the round clock (the full 30 s until the clock starts). */
  timeLeft(): number {
    if (!this.clockRunning) return ROUND_MS;
    const now = this.pausedAt ?? this.clock.now();
    return Math.max(0, ROUND_MS - (now - this.roundStart));
  }

  /** 0..1 through the round, for the fake guesser. */
  progress(): number {
    return Math.min(1, 1 - this.timeLeft() / ROUND_MS);
  }

  /** Start the game (round 1). */
  start() {
    this.nextRound();
  }

  /** Start the next round, or finish after the last. Ignored while a round is still being played. */
  nextRound() {
    if (!this.roundOver || this.stopped || this.finished) return;
    this.round++;
    if (this.round >= ROUNDS) return this.finish();
    this.roundId++;
    this.roundOver = false;
    this.abort = new AbortController();
    this.roundStart = this.clock.now();
    this.clockRunning = false;
    this.sketching = false;
    this.pendingDoodle = null;
    for (const p of this.players) {
      p.wrong = [];
      p.history = [];
      p.lastVersion = -1;
    }
    const tier = tierForRound(this.round);
    this.log('game', `Round ${this.round + 1}: "${this.word.word}" (${tier})`);
    this.events.roundStart?.(this.round, this.word, tier);
    this.startTimers();
    this.tick();
    if (this.doodler) void this.startDoodle();
  }

  private startTimers() {
    this.timers.push(this.clock.setInterval(() => this.tick(), TICK_MS));
    this.timers.push(this.clock.setInterval(() => this.poll(), POLL_MS));
  }

  private stopTimers() {
    this.timers.forEach((id) => this.clock.clearInterval(id));
    this.timers = [];
  }

  /** Advance the round clock; ends the round when time runs out. */
  tick() {
    if (this.roundOver || this.paused) return;
    const left = this.timeLeft();
    this.events.tick?.(left, this.clockRunning);
    if (left === 0) this.endRound(null);
  }

  /** Send one shared snapshot to every idle bot whose last view is out of date. */
  poll() {
    if (this.roundOver || this.paused || this.board.isEmpty) return;
    const version = this.board.changeVersion;
    const now = this.clock.now();
    const ready = this.players
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => !p.human && !p.disabled && !p.inFlight && now >= p.backoffUntil && p.lastVersion !== version);
    if (ready.length === 0) return;
    const image = this.board.snapshot();
    this.events.snapshot?.(image, ready.map((r) => r.i));
    if (!this.clockRunning) {
      // The clock starts when the bots first look, not when the round appears.
      this.clockRunning = true;
      this.roundStart = this.clock.now();
    }
    for (const { p, i } of ready) {
      p.lastVersion = version;
      void this.ask(i, image);
    }
  }

  private async ask(i: number, image: string) {
    const p = this.players[i];
    const roundId = this.roundId;
    const signal = this.abort.signal;
    p.inFlight = true;
    this.events.badge?.(i, 'thinking…', 'thinking');
    try {
      const { guess, confidence, usage } = await this.guessers[i].guess({ image, wrongGuesses: [...p.wrong], signal });
      // Billed even if the answer arrives too late to count.
      p.usage.calls++;
      if (usage) {
        p.usage.input += usage.input;
        p.usage.output += usage.output;
      }
      this.events.usage?.(i);
      if (roundId !== this.roundId || this.roundOver) return; // stale answer
      this.events.badge?.(i, '', '');
      this.guess(i, guess, confidence);
    } catch (e) {
      if (roundId !== this.roundId || (e as Error)?.name === 'AbortError') return;
      this.handleError(i, e);
    } finally {
      if (roundId === this.roundId) p.inFlight = false;
    }
  }

  /** You typed a guess (bot-doodler mode). Returns false if guessing isn't open right now. */
  submitGuess(text: string): boolean {
    const i = this.humanIndex;
    const guess = text.trim();
    if (i < 0 || !guess || this.roundOver || this.paused || !this.sketching) return false;
    this.guess(i, guess, null);
    return true;
  }

  /** A guess from a bot or from you: record it, and end the round if it's right. */
  private guess(i: number, guess: string, confidence: number | null) {
    const p = this.players[i];
    const right = isMatch(guess, this.word);
    const secs = ((this.clock.now() - this.roundStart) / 1000).toFixed(1);
    const entry = { guess, right, confidence, secs };
    p.history.push(entry);
    this.log('game', `${p.label} guessed "${guess}"${confidence === null ? '' : ` (${confidence}%)`}: ${right ? 'RIGHT ✓' : 'wrong'}`);
    this.events.guess?.(i, entry);
    if (right) this.endRound(i);
    else if (!p.wrong.includes(guess)) p.wrong.push(guess);
  }

  /** Back off (or sit out, for a bad key) after a failed request. */
  private handleError(i: number, e: unknown) {
    const p = this.players[i];
    const now = this.clock.now();
    if (e instanceof GuessError) {
      switch (e.kind) {
        case 'rate_limit':
          p.backoffUntil = now + (e.retryAfter ?? 10) * 1000;
          return this.events.badge?.(i, 'catching its breath…', 'warn');
        case 'auth':
          p.disabled = true;
          return this.events.badge?.(i, 'bad key 🔑 check it in Choose your bots', 'error', e.message);
        case 'network':
          p.backoffUntil = now + 5000;
          return this.events.badge?.(i, 'can’t reach this bot', 'error', e.message);
        default:
          p.backoffUntil = now + 5000;
          return this.events.badge?.(i, e.kind === 'bad_request' ? 'this model said no. Try another?' : 'oops, a hiccup', 'error', e.message);
      }
    }
    p.backoffUntil = now + 5000;
    this.events.badge?.(i, 'oops, a hiccup', 'error', String((e as Error)?.message ?? e));
  }

  /** End the round: winner is a player index, or null for nobody (time's up or skipped). */
  endRound(winner: number | null) {
    if (this.roundOver) return;
    this.roundOver = true;
    this.abort.abort();
    this.stopTimers();
    for (const [i, p] of this.players.entries()) {
      p.inFlight = false;
      if (!p.disabled) this.events.badge?.(i, '', '');
    }
    const seconds = winner === null ? null : (this.clock.now() - this.roundStart) / 1000;
    this.events.roundEnding?.();
    if (winner !== null) {
      this.players[winner].score++;
      this.playerScore++;
    }
    this.log('game', winner === null ? `Round ${this.round + 1} over: nobody got it` : `Round ${this.round + 1} won by ${this.players[winner].label} in ${seconds!.toFixed(1)}s`);
    const result: RoundResult = {
      word: this.word.word,
      winner,
      seconds,
      guesses: this.players.map((p) => [...p.wrong]),
      image: this.board.isEmpty ? null : this.board.snapshot(),
    };
    this.results.push(result);
    this.events.roundEnd?.(result, this.round);
  }

  /** Skip this round (nobody scores). */
  skip() {
    this.endRound(null);
  }

  /** Freeze the round: the clock stops and in-flight requests are cancelled (re-sent on resume). */
  pause() {
    if (this.paused || this.stopped || this.finished) return;
    this.pausedAt = this.clock.now();
    this.log('game', 'Paused');
    if (!this.roundOver) {
      this.stopTimers();
      this.abort.abort();
      for (const [i, p] of this.players.entries()) {
        p.inFlight = false;
        p.lastVersion = -1;
        if (!p.disabled) this.events.badge?.(i, '', '');
      }
    }
    this.events.pause?.(true);
  }

  resume() {
    if (!this.paused) return;
    const pausedFor = this.clock.now() - this.pausedAt!;
    this.log('game', `Resumed after ${(pausedFor / 1000).toFixed(1)}s`);
    this.pausedAt = null;
    if (!this.roundOver) {
      this.roundStart += pausedFor;
      for (const p of this.players) p.backoffUntil += pausedFor;
      this.abort = new AbortController();
      this.startTimers();
      if (this.pendingDoodle) {
        const d = this.pendingDoodle;
        this.pendingDoodle = null;
        this.beginSketch(d);
      }
    }
    this.events.pause?.(false);
    this.tick();
  }

  /** End the game now, with results for the rounds played so far. */
  stop() {
    if (this.stopped || this.finished) return;
    this.stopped = true;
    this.roundOver = true;
    this.abort.abort();
    this.stopTimers();
    this.finish();
  }

  // --- Bot-doodler mode --------------------------------------------------------------------

  /** The drawing for round r, requested once (retried once) and cached so it can be fetched early. */
  private doodleFor(r: number): Promise<Doodle> {
    let p = this.doodles.get(r);
    if (!p) {
      const word = this.words[r].word;
      const signal = this.doodleAbort.signal;
      const attempt = () =>
        this.doodler!.draw(word, signal).then((d) => {
          this.doodlerUsage.calls++;
          if (d.usage) {
            this.doodlerUsage.input += d.usage.input;
            this.doodlerUsage.output += d.usage.output;
          }
          this.events.doodlerUsage?.();
          return d;
        });
      p = attempt().catch((e) => {
        if ((e as Error)?.name === 'AbortError') throw e;
        return attempt();
      });
      p.catch(() => {}); // handled where it's awaited
      this.doodles.set(r, p);
    }
    return p;
  }

  private async startDoodle() {
    const roundId = this.roundId;
    this.events.doodleStatus?.('sketching');
    try {
      const doodle = await this.doodleFor(this.round);
      if (roundId !== this.roundId || this.roundOver) return;
      this.log('game', `Doodle for "${this.word.word}": ${doodle.strokes.length} strokes`, doodle.strokes);
      if (this.round + 1 < ROUNDS) void this.doodleFor(this.round + 1); // get the next one ready
      if (this.paused) this.pendingDoodle = doodle;
      else this.beginSketch(doodle);
    } catch (e) {
      if (roundId !== this.roundId || this.roundOver || (e as Error)?.name === 'AbortError') return;
      const why = e instanceof GuessError ? e.message : 'something went wrong';
      this.log('error', `Doodler failed twice for "${this.word.word}": ${why}`);
      this.events.doodleStatus?.('failed', why);
      this.clock.setTimeout(() => roundId === this.roundId && this.endRound(null), DOODLE_FAIL_MS);
    }
  }

  /** The drawing starts appearing; the round clock starts now and you may guess. */
  private beginSketch(doodle: Doodle) {
    this.sketching = true;
    this.clockRunning = true;
    this.roundStart = this.clock.now();
    this.events.sketch?.(doodle);
  }

  // -----------------------------------------------------------------------------------------

  private finish() {
    if (this.finished) return;
    this.finished = true;
    this.doodleAbort.abort(); // drop any drawing fetched ahead
    const humanIndex = this.humanIndex;
    this.log('game', this.stopped ? 'Game stopped' : 'Game over', {
      scores: Object.fromEntries(this.players.map((p) => [p.label, p.score])),
      usage: Object.fromEntries(this.players.map((p) => [p.label, p.usage])),
    });
    this.events.finish?.({
      ...(this.doodler ? { doodler: { label: this.doodler.label, usage: { ...this.doodlerUsage }, price: this.doodlerPrice }, humanIndex } : {}),
      usage: this.players.map((p) => ({ ...p.usage })),
      prices: this.players.map((p) => p.price),
      stopped: this.stopped,
      labels: this.players.map((p) => p.label),
      scores: this.players.map((p) => p.score),
      playerScore: this.playerScore,
      rounds: this.results,
    });
  }

  private log(kind: 'game' | 'error', message: string, data?: unknown) {
    this.events.log?.(kind, message, data);
  }
}

function newPlayer(label: string, price: Price): PlayerState {
  return {
    label,
    human: false,
    score: 0,
    wrong: [],
    history: [],
    inFlight: false,
    lastVersion: -1,
    backoffUntil: 0,
    disabled: false,
    usage: { input: 0, output: 0, calls: 0 },
    price,
  };
}
