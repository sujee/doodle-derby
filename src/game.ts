import { debug, debugImage } from './debug';
import { confetti, tapes, trash, undoArrow, you } from './art';
import { createDoodler, Sketcher, type Doodle, type Doodler } from './doodler';
import { costOf, formatTokens, formatUsd, priceFor, type Price, type Usage } from './pricing';
import { doodlerRow, Lane, Stars, starColumn } from './climb';
import { DrawingCanvas } from './canvas';
import { el } from './dom';
import { isMatch } from './match';
import { createGuesser, GuessError, type Guesser, type GuesserConfig } from './providers';
import * as sfx from './sound';
import { pickWords, ROUNDS, tierForRound, type Word } from './words';

const ROUND_MS = 30_000;
const POLL_MS = 2_500;
const TIERS = ['easy', 'medium', 'hard'] as const;
const HINT_KEY = 'doodle-duel-hint-seen';

function hintSeen(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

export type RoundResult = {
  word: string;
  winner: number | null;
  seconds: number | null;
  guesses: string[][];
  /** JPEG data URL of the final drawing, or null if the canvas was empty. */
  image: string | null;
};
export type GameResult = {
  labels: string[];
  /** Tokens and calls per bot (successful calls only; cancelled requests report nothing). */
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

type Player = {
  guesser: Guesser;
  /** You, guessing by typing (bot-doodler mode). Never polled. */
  human?: boolean;
  label: string;
  score: number;
  wrong: string[];
  /** Every guess this round, oldest first, for the pause screen. */
  history: { guess: string; right: boolean; confidence: number | null; secs: string }[];
  inFlight: boolean;
  lastVersion: number;
  backoffUntil: number;
  disabled: boolean;
  usage: Usage;
  price: Price;
  // UI
  lane: Lane;
  meterEl: HTMLElement;
  scoreEl: HTMLElement;
  badgeEl: HTMLElement;
  feedEl: HTMLElement;
};

export class Game {
  private words: Word[] = pickWords();
  private round = -1;
  private roundId = 0;
  private roundStart = 0;
  /** The 30 s clock starts when the first snapshot goes to the bots, not when the round appears. */
  private clockRunning = false;
  private roundOver = true;
  private abort = new AbortController();
  private timers: number[] = [];
  private pausedAt = 0; // 0 = not paused
  private pauseBtn = el('button', { type: 'button', class: 'pause-btn', title: 'Pause and see this round’s guesses (P)' }, '⏸ Pause');
  private pauseEl = el('div', { class: 'pause-layer', hidden: '' });
  private stopped = false;
  private playerScore = 0;
  private results: RoundResult[] = [];
  private players: Player[];
  private canvas: DrawingCanvas;

  private roundEl = el('span');
  private tierEl = el('span', { class: 'tier' });
  private wordEl = el('span', { class: 'word' });
  private timerEl = el('span', { class: 'timer' });
  private timerBar = el('div', { class: 'pencil', 'aria-hidden': 'true' }, [
    el('span', { class: 'pencil-end' }),
    el('span', { class: 'pencil-body' }),
    el('span', { class: 'pencil-tip' }),
  ]);
  private paper = el('div', { class: 'paper' });
  private lastBeat = '';
  private youScoreEl = el('span', { class: 'sr-only' }, '0');
  private youStars = new Stars();
  private hint = el('div', { class: 'hint', 'aria-hidden': 'true' }, 'Draw here! The clock starts when the bots start guessing ✏️');
  private overlay = el('div', { class: 'overlay', hidden: '' });
  private drawLabel = el('span', { class: 'draw-label' }, 'Your turn to draw: ');

  // Bot-doodler mode
  private doodler: Doodler | null = null;
  private doodlerLabel = '';
  private doodlerUsage: Usage = { input: 0, output: 0, calls: 0 };
  private doodlerPrice: Price = { kind: 'unknown' };
  private doodlerMeter = el('div', { class: 'meter' });
  /** Drawings already requested, by round, so the next one is ready when its round starts. */
  private doodles = new Map<number, Promise<Doodle>>();
  private doodleAbort = new AbortController();
  private sketcher: Sketcher | null = null;
  private lastSketch = 0;
  private pendingDoodle: Doodle | null = null;
  private sketchEl = el('div', { class: 'sketching', hidden: '' });
  private guessInput = el('input', {
    type: 'text',
    class: 'guess-input',
    placeholder: 'What is it? Type your guess…',
    autocomplete: 'off',
    'aria-label': 'Your guess',
  }) as HTMLInputElement;

  constructor(
    private container: HTMLElement,
    configs: GuesserConfig[],
    private onDone: (r: GameResult) => void,
    doodlerConfig: GuesserConfig | null = null,
  ) {
    const fakeCtx = {
      target: () => this.words[this.round],
      progress: () => Math.min(1, (performance.now() - this.roundStart) / ROUND_MS),
      difficulty: () => TIERS.indexOf(tierForRound(this.round)),
    };
    this.players = configs.map((c) => ({
      guesser: createGuesser(c, fakeCtx),
      label: '',
      score: 0,
      wrong: [],
      history: [],
      inFlight: false,
      lastVersion: -1,
      backoffUntil: 0,
      disabled: false,
      usage: { input: 0, output: 0, calls: 0 },
      price: priceFor(c),
      lane: null as unknown as Lane, // built in render()
      meterEl: el('div', { class: 'meter', title: 'Tokens in / out and cost so far' }),
      scoreEl: el('span', { class: 'score', title: 'Rounds won' }, '0'),
      badgeEl: el('span', { class: 'badge', hidden: '' }),
      feedEl: el('ol', { class: 'feed' }),
    }));
    if (doodlerConfig) {
      this.doodler = createDoodler(doodlerConfig);
      this.doodlerLabel = this.doodler.label;
      this.doodlerPrice = priceFor(doodlerConfig);
      // You join the guessers, after the bots.
      this.players.push({
        guesser: { label: 'You', guess: () => Promise.reject(new Error('You guess by typing')) },
        human: true,
        label: 'You',
        score: 0,
        wrong: [],
        history: [],
        inFlight: false,
        lastVersion: -1,
        backoffUntil: 0,
        disabled: false,
        usage: { input: 0, output: 0, calls: 0 },
        price: { kind: 'free', why: 'you' },
        lane: null as unknown as Lane,
        meterEl: el('div', { class: 'meter' }, 'type your guesses below'),
        scoreEl: el('span', { class: 'score', title: 'Rounds won' }, '0'),
        badgeEl: el('span', { class: 'badge', hidden: '' }),
        feedEl: el('ol', { class: 'feed' }),
      });
    }
    // Same model twice gets numbered labels so the scoreboard stays readable.
    for (const [i, p] of this.players.entries()) {
      if (p.human) continue;
      const dup = this.players.filter((q) => q.guesser.label === p.guesser.label).length > 1;
      p.label = dup ? `${p.guesser.label} #${i + 1}` : p.guesser.label;
    }
    this.canvas = new DrawingCanvas(el('canvas', { class: 'pad' }) as HTMLCanvasElement);
    this.render();
    this.nextRound();
  }

  private render() {
    const tool = (label: string, onClick: () => void, cls = '', icon?: Node | string) => {
      const b = el('button', { type: 'button', class: cls, title: label }, icon === undefined ? label : [
        el('span', { class: 'tool-icon', 'aria-hidden': 'true' }, icon),
        el('span', { class: 'tool-label' }, label),
      ]);
      b.addEventListener('click', onClick);
      return b;
    };
    const pen = tool('Pen', () => setTool(pen, '#111111', 6), 'tool crayon active', '');
    const eraser = tool('Eraser', () => setTool(eraser, '#ffffff', 28), 'tool rubber', '');
    const setTool = (btn: HTMLElement, color: string, width: number) => {
      this.canvas.color = color;
      this.canvas.width = width;
      pen.classList.toggle('active', btn === pen);
      eraser.classList.toggle('active', btn === eraser);
    };

    // No right-click menu anywhere on the paper: the canvas and the pop-ups over it (reveal, pause, sketching).
    this.paper.addEventListener('contextmenu', (e) => e.preventDefault());
    this.paper.replaceChildren(...tapes(), this.canvas.el, this.sketchEl, this.overlay);
    if (!hintSeen() && !this.doodler) {
      this.paper.append(this.hint);
      this.canvas.el.addEventListener('pointerdown', () => this.hideHint(), { once: true });
    }
    const stop = el('button', { type: 'button', class: 'icon-btn stop', title: 'Stop game', 'aria-label': 'Stop game' }, '✕');
    stop.addEventListener('click', () => this.stop());
    this.pauseBtn.addEventListener('click', () => (this.pausedAt ? this.resume() : this.pause()));
    // P pauses / resumes (unless you're typing a guess).
    const onKey = (e: KeyboardEvent) => {
      if (!this.paper.isConnected) return document.removeEventListener('keydown', onKey);
      if (e.key.toLowerCase() !== 'p' || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      e.preventDefault();
      if (this.pausedAt) this.resume();
      else this.pause();
    };
    document.addEventListener('keydown', onKey);
    this.paper.append(this.pauseEl);
    this.container.replaceChildren(
      el('section', { class: 'game' }, [
        el('header', { class: 'hud' }, [
          el('div', { class: 'round' }, [this.roundEl, this.tierEl]),
          el('div', { class: 'prompt' }, [this.drawLabel, this.wordEl]),
          el('div', { class: 'hud-right' }, [el('div', { class: 'clock' }, [this.timerBar, this.timerEl]), this.pauseBtn, stop]),
        ]),
        el('div', { class: 'board' }, [
          el('div', { class: 'pad-wrap' }, [
            el('div', { class: 'paper-row' }, [starColumn(this.youScoreEl, this.youStars, !!this.doodler), this.paper]),
            this.doodler
              ? this.guessForm(tool('Skip', () => this.endRound(null), 'tool ghost', '⏭'))
              : el('div', { class: 'tools' }, [
                  pen,
                  eraser,
                  tool('Undo', () => this.canvas.undo(), 'tool', undoArrow()),
                  tool('Clear', () => this.canvas.clear(), 'tool', trash()),
                  tool('Skip', () => this.endRound(null), 'tool ghost', '⏭'),
                ]),
          ]),
          el('aside', { class: 'climb' }, [
            el(
              'div',
              { class: 'lanes' },
              this.players.map((p, i) => {
                p.lane = new Lane(i, p.label, [p.badgeEl, p.feedEl], p.scoreEl, p.meterEl, p.human ? you() : undefined);
                this.updateMeter(p);
                return p.lane.el;
              }),
            ),
            ...(this.doodler ? [(this.updateDoodlerMeter(), doodlerRow(this.doodlerLabel, this.doodlerMeter))] : []),
          ]),
        ]),
      ]),
    );
  }

  private nextRound() {
    if (!this.roundOver) return; // a round is still being played
    if (this.stopped) return;
    this.round++;
    if (this.round >= ROUNDS) return this.finish();
    this.roundId++;
    this.roundOver = false;
    this.abort = new AbortController();
    this.roundStart = performance.now();
    this.clockRunning = false;
    this.overlay.hidden = true;
    this.canvas.clear();
    this.canvas.setEnabled(!this.doodler);
    this.sketcher = null;
    this.pendingDoodle = null;
    this.guessInput.value = '';
    sfx.roundStart();

    const tier = tierForRound(this.round);
    this.roundEl.textContent = `Round ${this.round + 1}/${ROUNDS}`;
    this.tierEl.textContent = tier;
    this.tierEl.className = `tier ${tier}`;
    debug('game', `Round ${this.round + 1}: "${this.words[this.round].word}" (${tier})`);
    this.wordEl.textContent = this.doodler ? '???' : this.words[this.round].word;
    this.drawLabel.textContent = this.doodler ? 'Guess the doodle: ' : 'Your turn to draw: ';
    for (const p of this.players) {
      p.wrong = [];
      p.history = [];
      p.lastVersion = -1;
      p.feedEl.replaceChildren();
      p.lane.reset();
    }

    this.timers.push(window.setInterval(() => this.tickTimer(), 100));
    this.timers.push(window.setInterval(() => this.poll(), POLL_MS));
    this.tickTimer();
    if (this.doodler) this.startDoodle();
  }

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
          this.updateDoodlerMeter();
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
    this.sketchEl.replaceChildren(el('div', { class: 'reveal card' }, [el('p', { class: 'kicker' }, `✏️ ${this.doodlerLabel} is sketching…`)]));
    this.sketchEl.hidden = false;
    try {
      const doodle = await this.doodleFor(this.round);
      debug('game', `Doodle for "${this.words[this.round].word}": ${doodle.strokes.length} strokes`, doodle.strokes);
      if (roundId !== this.roundId || this.roundOver) return;
      if (this.round + 1 < ROUNDS) this.doodleFor(this.round + 1); // get the next one ready
      if (this.pausedAt) this.pendingDoodle = doodle;
      else this.beginSketch(doodle);
    } catch (e) {
      if (roundId !== this.roundId || this.roundOver || (e as Error)?.name === 'AbortError') return;
      const why = e instanceof GuessError ? e.message : 'something went wrong';
      debug('error', `Doodler failed twice for "${this.words[this.round].word}": ${why}`);
      this.sketchEl.replaceChildren(
        el('div', { class: 'reveal card' }, [el('h2', {}, 'The doodler got stuck 😵'), el('p', {}, `${why}. Skipping this round…`)]),
      );
      setTimeout(() => roundId === this.roundId && this.endRound(null), 2500);
    }
  }

  /** Start animating the bot's strokes; the round clock starts now. */
  private beginSketch(doodle: Doodle) {
    this.sketchEl.hidden = true;
    this.sketcher = new Sketcher(this.canvas, doodle.strokes);
    this.clockRunning = true;
    this.roundStart = performance.now();
    this.guessInput.focus({ preventScroll: true });
    this.startSketchTimer();
  }

  /**
   * Animate on a timer rather than requestAnimationFrame: rAF stops in background tabs, which would
   * freeze the drawing while the round clock keeps running. Progress follows elapsed time, so a
   * throttled timer just draws in bigger steps. Lives in this.timers, so pause and endRound stop it.
   */
  private startSketchTimer() {
    if (!this.sketcher || this.sketcher.done) return;
    this.lastSketch = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      this.sketcher?.tick(now - this.lastSketch);
      this.lastSketch = now;
      if (!this.sketcher || this.sketcher.done) clearInterval(id);
    }, 40);
    this.timers.push(id);
  }

  /** Bot-doodler mode: a text box for your guesses, plus Skip. */
  private guessForm(skip: HTMLElement): HTMLElement {
    const form = el('form', { class: 'guess-form' }, [
      this.guessInput,
      el('button', { type: 'submit', class: 'primary' }, 'Guess!'),
      skip,
    ]) as HTMLFormElement;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.guessInput.value.trim();
      const you = this.players.find((p) => p.human)!;
      if (!text || this.roundOver || !this.sketcher || this.pausedAt) return;
      this.guessInput.value = '';
      this.onGuess(you, text, null);
    });
    return form;
  }

  private tickTimer() {
    const left = this.clockRunning ? Math.max(0, ROUND_MS - (performance.now() - this.roundStart)) : ROUND_MS;
    this.timerBar.parentElement?.classList.toggle('waiting', !this.clockRunning);
    this.timerEl.textContent = `${Math.ceil(left / 1000)}s`;
    this.timerBar.style.setProperty('--left', String(left / ROUND_MS));
    this.timerEl.classList.toggle('low', left < 8000);
    this.timerBar.classList.toggle('low', left < 8000);
    // Tick-tock in the last 5 s, twice as fast in the last 3.
    if (left > 0 && left <= 5000 && !sfx.reducedMotion()) {
      const n = left <= 3000 ? Math.ceil(left / 500) : Math.ceil(left / 1000);
      const beat = `${left <= 3000 ? 'h' : 's'}${n}`;
      if (beat !== this.lastBeat) sfx.tick(n % 2 === 0);
      this.lastBeat = beat;
    }
    if (left === 0) this.endRound(null);
  }

  /** Send one shared snapshot to every idle guesser whose last view is out of date. */
  private poll() {
    if (this.roundOver || this.canvas.isEmpty) return;
    const version = this.canvas.changeVersion;
    const now = performance.now();
    const ready = this.players.filter(
      (p) => !p.human && !p.disabled && !p.inFlight && now >= p.backoffUntil && p.lastVersion !== version,
    );
    if (ready.length === 0) return;
    const image = this.canvas.snapshot();
    debugImage(`Snapshot → ${ready.map((p) => p.label).join(', ')}`, image);
    if (!this.clockRunning) {
      this.clockRunning = true;
      this.roundStart = performance.now();
    }
    for (const p of ready) {
      p.lastVersion = version;
      this.ask(p, image);
    }
  }

  private async ask(p: Player, image: string) {
    const roundId = this.roundId;
    const signal = this.abort.signal;
    p.inFlight = true;
    this.setBadge(p, 'thinking…', 'thinking');
    try {
      const { guess, confidence, usage } = await p.guesser.guess({ image, wrongGuesses: [...p.wrong], signal });
      // Billed even if the answer arrives too late to count.
      p.usage.calls++;
      if (usage) {
        p.usage.input += usage.input;
        p.usage.output += usage.output;
      }
      this.updateMeter(p);
      if (roundId !== this.roundId || this.roundOver) return; // stale answer
      this.setBadge(p, '');
      this.onGuess(p, guess, confidence);
    } catch (e) {
      if (roundId !== this.roundId || (e as Error)?.name === 'AbortError') return;
      this.handleError(p, e);
    } finally {
      if (roundId === this.roundId) p.inFlight = false;
    }
  }

  /** A guess from a bot or from you: show it, and end the round if it's right. */
  private onGuess(p: Player, guess: string, confidence: number | null) {
    const right = isMatch(guess, this.words[this.round]);
    debug('game', `${p.label} guessed "${guess}"${confidence === null ? '' : ` (${confidence}%)`}: ${right ? 'RIGHT ✓' : 'wrong'}`);
    this.addGuess(p, guess, right, confidence);
    if (right) this.endRound(this.players.indexOf(p));
    else if (!p.wrong.includes(guess)) p.wrong.push(guess);
  }

  private handleError(p: Player, e: unknown) {
    const now = performance.now();
    if (e instanceof GuessError) {
      switch (e.kind) {
        case 'rate_limit':
          p.backoffUntil = now + (e.retryAfter ?? 10) * 1000;
          return this.setBadge(p, 'catching its breath…', 'warn');
        case 'auth':
          p.disabled = true;
          return this.setBadge(p, 'bad key 🔑 check it in Choose your bots', 'error', e.message);
        case 'network':
          p.backoffUntil = now + 5000;
          return this.setBadge(p, 'can’t reach this bot', 'error', e.message);
        default:
          p.backoffUntil = now + 5000;
          return this.setBadge(p, e.kind === 'bad_request' ? 'this model said no. Try another?' : 'oops, a hiccup', 'error', e.message);
      }
    }
    p.backoffUntil = now + 5000;
    this.setBadge(p, 'oops, a hiccup', 'error', String((e as Error)?.message ?? e));
  }

  private setBadge(p: Player, text: string, kind = '', title = '') {
    p.badgeEl.textContent = text;
    p.badgeEl.className = `badge ${kind}`;
    p.badgeEl.title = title;
    p.badgeEl.hidden = !text;
    p.lane.setThinking(kind === 'thinking');
  }

  private hideHint() {
    this.hint.remove();
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      // storage blocked: the hint just shows again next time
    }
  }

  private addGuess(p: Player, guess: string, right: boolean, confidence: number | null) {
    const secs = ((performance.now() - this.roundStart) / 1000).toFixed(1);
    p.history.push({ guess, right, confidence, secs });
    sfx.pop(this.players.indexOf(p));
    if (!right) setTimeout(sfx.wrong, 260);
    p.feedEl.prepend(
      el('li', { class: right ? 'right' : 'nope' }, [
        el('span', { class: 'guess' }, guess),
        el('span', { class: 'when' }, [confidence === null ? '' : el('span', { class: 'conf' }, `${confidence}%`), `${secs}s`]),
      ]),
    );
  }

  private endRound(winner: number | null) {
    if (this.roundOver) return;
    this.roundOver = true;
    this.abort.abort();
    this.timers.forEach(clearInterval);
    this.timers = [];
    this.canvas.setEnabled(false);
    this.hint.remove();
    this.sketchEl.hidden = true;
    this.sketcher?.tick(Infinity); // show the whole doodle at the reveal
    this.wordEl.textContent = this.words[this.round].word;
    for (const p of this.players) {
      p.inFlight = false;
      if (!p.disabled) this.setBadge(p, '');
    }

    const seconds = winner === null ? null : (performance.now() - this.roundStart) / 1000;
    debug('game', winner === null ? `Round ${this.round + 1} over: nobody got it` : `Round ${this.round + 1} won by ${this.players[winner].label} in ${seconds!.toFixed(1)}s`);
    if (winner !== null) {
      this.players[winner].score++;
      this.players[winner].scoreEl.textContent = String(this.players[winner].score);
      this.playerScore++;
      this.youScoreEl.textContent = String(this.playerScore);
      this.youStars.fill(this.playerScore);
    }
    const word = this.words[this.round].word;
    if (winner !== null) {
      sfx.ding();
      confetti(this.paper);
      this.players[winner].lane.win(this.players[winner].score);
    } else {
      sfx.wahWah();
      for (const p of this.players) p.lane.shrug();
    }
    this.results.push({
      word,
      winner,
      seconds,
      guesses: this.players.map((p) => [...p.wrong]),
      image: this.canvas.isEmpty ? null : this.canvas.snapshot(),
    });

    // The next round starts only when you click (or press Enter on the focused button).
    const last = this.round === ROUNDS - 1;
    const next = el('button', { class: 'primary big next-round' }, last ? 'See results 🏆' : `Start round ${this.round + 2} ✏️`);
    next.addEventListener('click', () => this.nextRound());
    this.overlay.replaceChildren(
      el('div', { class: `reveal card ${winner === null ? 'missed' : 'got-it'}` }, [
        ...(winner === null
          ? [
              el('p', { class: 'kicker' }, 'Time’s up! It was a…'),
              el('h2', { class: 'reveal-word' }, `${word}!`),
              el('p', {}, 'Nobody scores this round.'),
            ]
          : [
              el('div', { class: 'stamp', 'aria-hidden': 'true' }, 'DING! ✓'),
              el('h2', {}, this.players[winner].human ? 'You nailed it!' : `${this.players[winner].label} nailed it!`),
              el(
                'p',
                {},
                this.doodler
                  ? `“${word}” in ${seconds!.toFixed(1)}s. A star for ${this.players[winner].human ? 'you' : 'the bot'} and a star for the doodler!`
                  : `“${word}” in ${seconds!.toFixed(1)}s. A star for the bot and a star for you!`,
              ),
            ]),
        next,
      ]),
    );
    this.overlay.classList.toggle('won', winner !== null);
    this.overlay.hidden = false;
    next.focus({ preventScroll: true });
  }

  /** The pause screen: every guess so far this round, one column per guesser. */
  private renderPauseCard() {
    const resume = el('button', { type: 'button', class: 'primary big' }, this.doodler ? 'Keep guessing!' : 'Keep drawing!');
    resume.addEventListener('click', () => this.resume());
    const total = this.players.reduce((n, p) => n + p.history.length, 0);
    const word = this.roundOver || !this.doodler ? this.words[this.round].word : '???';
    const columns = this.players.map((p, i) =>
      el('div', { class: `pause-col ${p.human ? 'human' : `p${i}`}` }, [
        el('h3', { title: p.label }, p.label),
        p.history.length
          ? el(
              'ol',
              { class: 'pause-guesses' },
              p.history.map((h) =>
                el('li', { class: h.right ? 'right' : 'nope' }, [
                  el('span', { class: 'mark', 'aria-hidden': 'true' }, h.right ? '✓' : '✗'),
                  el('span', { class: 'guess' }, h.guess),
                  el('span', { class: 'when' }, `${h.confidence === null ? '' : `${h.confidence}% · `}${h.secs}s`),
                ]),
              ),
            )
          : el('p', { class: 'note' }, p.human ? 'no guesses yet' : 'still thinking…'),
      ]),
    );
    this.pauseEl.replaceChildren(
      el('div', { class: 'reveal card pause-card' }, [
        el('h2', {}, 'Paused ☕'),
        el('p', { class: 'kicker' }, [
          `Round ${this.round + 1} · `,
          el('strong', {}, word),
          ` · ${total} guess${total === 1 ? '' : 'es'} so far`,
        ]),
        el('div', { class: 'pause-cols' }, columns),
        resume,
      ]),
    );
    resume.focus({ preventScroll: true });
  }

  /** Freeze the round. In-flight requests are cancelled and re-sent on resume. Between rounds it just shows the guesses. */
  private pause() {
    if (this.pausedAt || this.stopped) return;
    this.pausedAt = performance.now();
    debug('game', 'Paused');
    if (!this.roundOver) {
      this.timers.forEach(clearInterval);
      this.timers = [];
      this.abort.abort();
      this.canvas.setEnabled(false);
      for (const p of this.players) {
        p.inFlight = false;
        p.lastVersion = -1;
        if (!p.disabled) this.setBadge(p, '');
      }
    }
    this.pauseBtn.textContent = '▶ Resume';
    this.pauseBtn.title = 'Resume (P)';
    this.renderPauseCard();
    this.pauseEl.hidden = false;
    this.paper.closest('.game')?.classList.add('paused');
  }

  private resume() {
    if (!this.pausedAt) return;
    const pausedFor = performance.now() - this.pausedAt;
    debug('game', `Resumed after ${(pausedFor / 1000).toFixed(1)}s`);
    this.pausedAt = 0;
    if (!this.roundOver) {
      this.roundStart += pausedFor;
      for (const p of this.players) p.backoffUntil += pausedFor;
      this.abort = new AbortController();
      this.canvas.setEnabled(!this.doodler);
      this.timers.push(window.setInterval(() => this.tickTimer(), 100));
      this.timers.push(window.setInterval(() => this.poll(), POLL_MS));
      this.tickTimer();
      if (this.pendingDoodle) {
        const d = this.pendingDoodle;
        this.pendingDoodle = null;
        this.beginSketch(d);
      } else {
        this.startSketchTimer(); // carry on drawing where it paused
      }
    }
    this.pauseBtn.textContent = '⏸ Pause';
    this.pauseBtn.title = 'Pause and see this round’s guesses (P)';
    this.pauseEl.hidden = true;
    this.paper.closest('.game')?.classList.remove('paused');
  }

  /** End the game now and show results for the rounds played so far. */
  private stop() {
    if (!confirm('Stop the game and see the results so far?')) return;
    this.stopped = true;
    this.roundOver = true;
    this.abort.abort();
    this.timers.forEach(clearInterval);
    this.canvas.setEnabled(false);
    this.finish();
  }

  private updateDoodlerMeter() {
    const { input, output } = this.doodlerUsage;
    const cost = costOf(this.doodlerUsage, this.doodlerPrice);
    this.doodlerMeter.textContent =
      this.doodlerPrice.kind === 'free' ? (this.doodlerPrice.why === 'fake bot' ? 'free (fake bot)' : 'free') : `${formatTokens(input)} in · ${formatTokens(output)} out${cost === null ? '' : ` · ${formatUsd(cost)}`}`;
  }

  private updateMeter(p: Player) {
    if (p.human) return; // your lane keeps its "type your guesses" hint
    const { input, output } = p.usage;
    if (p.price.kind === 'free') {
      p.meterEl.textContent = p.price.why === 'fake bot' ? 'free (fake bot)' : `${formatTokens(input)} in · ${formatTokens(output)} out · free`;
      return;
    }
    const cost = costOf(p.usage, p.price);
    p.meterEl.textContent = `${formatTokens(input)} in · ${formatTokens(output)} out${cost === null ? '' : ` · ${formatUsd(cost)}`}`;
  }

  private finish() {
    this.doodleAbort.abort(); // drop any drawing fetched ahead
    const humanIndex = this.players.findIndex((p) => p.human);
    debug('game', this.stopped ? 'Game stopped' : 'Game over', {
      scores: Object.fromEntries(this.players.map((p) => [p.label, p.score])),
      usage: Object.fromEntries(this.players.map((p) => [p.label, p.usage])),
    });
    this.onDone({
      ...(this.doodler ? { doodler: { label: this.doodlerLabel, usage: { ...this.doodlerUsage }, price: this.doodlerPrice }, humanIndex } : {}),
      usage: this.players.map((p) => ({ ...p.usage })),
      prices: this.players.map((p) => p.price),
      stopped: this.stopped,
      labels: this.players.map((p) => p.label),
      scores: this.players.map((p) => p.score),
      playerScore: this.playerScore,
      rounds: this.results,
    });
  }
}
