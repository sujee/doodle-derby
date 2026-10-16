import { confetti, tapes, trash, undoArrow } from './art';
import { costOf, formatTokens, formatUsd, priceFor, type Price, type Usage } from './pricing';
import { Lane, Stars, youRow } from './climb';
import { DrawingCanvas } from './canvas';
import { el } from './dom';
import { isMatch } from './match';
import { createGuesser, GuessError, type Guesser, type GuesserConfig } from './providers';
import * as sfx from './sound';
import { pickWords, ROUNDS, tierForRound, type Word } from './words';

const ROUND_MS = 30_000;
const POLL_MS = 2_500;
const NEXT_ROUND_SECS = 5;
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
};

type Player = {
  guesser: Guesser;
  label: string;
  score: number;
  wrong: string[];
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
  private advanceTimer = 0;
  private countdownTick: (() => void) | null = null;
  private pausedAt = 0; // 0 = not paused
  private pauseBtn = el('button', { type: 'button', class: 'icon-btn pause', title: 'Pause', 'aria-label': 'Pause' }, '⏸');
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

  constructor(
    private container: HTMLElement,
    configs: GuesserConfig[],
    private onDone: (r: GameResult) => void,
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
    // Same model twice gets numbered labels so the scoreboard stays readable.
    for (const [i, p] of this.players.entries()) {
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

    this.canvas.el.addEventListener('contextmenu', (e) => e.preventDefault()); // no right-click menu while drawing
    this.paper.replaceChildren(...tapes(), this.canvas.el, this.overlay);
    if (!hintSeen()) {
      this.paper.append(this.hint);
      this.canvas.el.addEventListener('pointerdown', () => this.hideHint(), { once: true });
    }
    const stop = el('button', { type: 'button', class: 'icon-btn stop', title: 'Stop game', 'aria-label': 'Stop game' }, '✕');
    stop.addEventListener('click', () => this.stop());
    this.pauseBtn.addEventListener('click', () => (this.pausedAt ? this.resume() : this.pause()));
    const resume = el('button', { type: 'button', class: 'primary big' }, 'Keep drawing!');
    resume.addEventListener('click', () => this.resume());
    this.pauseEl.replaceChildren(el('div', { class: 'reveal card' }, [el('h2', {}, 'Paused ☕'), el('p', {}, 'Take a breather. The bots will wait.'), resume]));
    this.paper.append(this.pauseEl);
    this.container.replaceChildren(
      el('section', { class: 'game' }, [
        el('header', { class: 'hud' }, [
          el('div', { class: 'round' }, [this.roundEl, this.tierEl]),
          el('div', { class: 'prompt' }, [el('span', { class: 'draw-label' }, 'Your turn to draw: '), this.wordEl]),
          el('div', { class: 'hud-right' }, [el('div', { class: 'clock' }, [this.timerBar, this.timerEl]), this.pauseBtn, stop]),
        ]),
        el('div', { class: 'board' }, [
          el('div', { class: 'pad-wrap' }, [
            this.paper,
            el('div', { class: 'tools' }, [
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
                p.lane = new Lane(i, p.label, [p.badgeEl, p.feedEl], p.scoreEl, p.meterEl);
                this.updateMeter(p);
                return p.lane.el;
              }),
            ),
            youRow(this.youScoreEl, this.youStars),
          ]),
        ]),
      ]),
    );
  }

  private nextRound() {
    clearInterval(this.advanceTimer);
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
    this.canvas.setEnabled(true);
    sfx.roundStart();

    const tier = tierForRound(this.round);
    this.roundEl.textContent = `Round ${this.round + 1}/${ROUNDS}`;
    this.tierEl.textContent = tier;
    this.tierEl.className = `tier ${tier}`;
    this.wordEl.textContent = this.words[this.round].word;
    for (const p of this.players) {
      p.wrong = [];
      p.lastVersion = -1;
      p.feedEl.replaceChildren();
      p.lane.reset();
    }

    this.timers.push(window.setInterval(() => this.tickTimer(), 100));
    this.timers.push(window.setInterval(() => this.poll(), POLL_MS));
    this.tickTimer();
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
      (p) => !p.disabled && !p.inFlight && now >= p.backoffUntil && p.lastVersion !== version,
    );
    if (ready.length === 0) return;
    const image = this.canvas.snapshot();
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
      const right = isMatch(guess, this.words[this.round]);
      this.addGuess(p, guess, right, confidence);
      if (right) this.endRound(this.players.indexOf(p));
      else if (!p.wrong.includes(guess)) p.wrong.push(guess);
    } catch (e) {
      if (roundId !== this.roundId || (e as Error)?.name === 'AbortError') return;
      this.handleError(p, e);
    } finally {
      if (roundId === this.roundId) p.inFlight = false;
    }
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
    for (const p of this.players) {
      p.inFlight = false;
      if (!p.disabled) this.setBadge(p, '');
    }

    const seconds = winner === null ? null : (performance.now() - this.roundStart) / 1000;
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

    const last = this.round === ROUNDS - 1;
    const next = el('button', { class: 'primary' }, last ? 'See results' : 'Next round');
    next.addEventListener('click', () => this.nextRound());
    const countdown = el('p', { class: 'countdown' });
    let secs = NEXT_ROUND_SECS;
    const tick = () => {
      countdown.replaceChildren(
        el('span', { class: 'count-label' }, last ? 'Results in' : 'Next round in'),
        el('span', { class: 'count-num' }, String(secs)),
      );
      if (secs > 0 && secs <= 3) sfx.blip(secs);
      if (secs-- === 0) this.nextRound();
    };
    tick();
    this.countdownTick = tick;
    this.advanceTimer = window.setInterval(tick, 1000);
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
              el('h2', {}, `${this.players[winner].label} nailed it!`),
              el('p', {}, `“${word}” in ${seconds!.toFixed(1)}s. A star for the bot and a star for you!`),
            ]),
        countdown,
        next,
      ]),
    );
    this.overlay.classList.toggle('won', winner !== null);
    this.overlay.hidden = false;
    next.focus({ preventScroll: true });
  }

  /** Freeze the round (or the countdown between rounds). In-flight requests are cancelled and re-sent on resume. */
  private pause() {
    if (this.pausedAt || this.stopped) return;
    this.pausedAt = performance.now();
    if (this.roundOver) {
      clearInterval(this.advanceTimer);
    } else {
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
    this.pauseBtn.textContent = '▶';
    this.pauseBtn.title = 'Resume';
    this.pauseBtn.setAttribute('aria-label', 'Resume');
    this.pauseEl.hidden = false;
    this.paper.closest('.game')?.classList.add('paused');
  }

  private resume() {
    if (!this.pausedAt) return;
    const pausedFor = performance.now() - this.pausedAt;
    this.pausedAt = 0;
    if (this.roundOver) {
      if (this.countdownTick) this.advanceTimer = window.setInterval(this.countdownTick, 1000);
    } else {
      this.roundStart += pausedFor;
      for (const p of this.players) p.backoffUntil += pausedFor;
      this.abort = new AbortController();
      this.canvas.setEnabled(true);
      this.timers.push(window.setInterval(() => this.tickTimer(), 100));
      this.timers.push(window.setInterval(() => this.poll(), POLL_MS));
      this.tickTimer();
    }
    this.pauseBtn.textContent = '⏸';
    this.pauseBtn.title = 'Pause';
    this.pauseBtn.setAttribute('aria-label', 'Pause');
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
    clearInterval(this.advanceTimer);
    this.canvas.setEnabled(false);
    this.finish();
  }

  private updateMeter(p: Player) {
    const { input, output } = p.usage;
    if (p.price.kind === 'free') {
      p.meterEl.textContent = p.price.why === 'fake bot' ? 'free (fake bot)' : `${formatTokens(input)} in · ${formatTokens(output)} out · free`;
      return;
    }
    const cost = costOf(p.usage, p.price);
    p.meterEl.textContent = `${formatTokens(input)} in · ${formatTokens(output)} out${cost === null ? '' : ` · ${formatUsd(cost)}`}`;
  }

  private finish() {
    this.onDone({
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
