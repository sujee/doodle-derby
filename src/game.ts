/**
 * The game screen. The rules live in engine.ts; this class builds the DOM, wires the controls to the
 * engine, and draws whatever the engine reports (rounds, guesses, scores, pause, results).
 */

import { botColor, confetti, replay, robot, tapes, trash, undoArrow, you } from './art';
import { DrawingCanvas } from './canvas';
import { doodlerRow } from './climb';
import { FieldRow } from './field';
import { debug, debugImage } from './debug';
import { el } from './dom';
import { createDoodler, Sketcher } from './doodler';
import { Engine, ROUND_MS, type BadgeKind, type GameResult, type GuessEntry, type RoundResult } from './engine';
import { priceFor } from './pricing';
import { createGuesser, providerName, type GuesserConfig } from './providers';
import { openShareDialog, shortName } from './share';
import * as sfx from './sound';
import { ROUNDS, type Tier, type Word } from './words';

export type { GameResult, RoundResult } from './engine';

const HINT_KEY = 'doodle-derby-hint-seen';

function hintSeen(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

/** Per-player widgets (same index as engine.players). */
type PlayerView = { row: FieldRow; scoreEl: HTMLElement; badgeEl: HTMLElement; feedEl: HTMLElement };

export class Game {
  readonly engine: Engine;
  private canvas: DrawingCanvas;
  private views: PlayerView[];
  private botDraws: boolean;

  // Icon + label; phones show just the icon so the whole HUD fits on one row.
  private pauseBtn = el('button', { type: 'button', class: 'pause-btn', title: 'Pause and see this round’s guesses (P)', 'aria-label': 'Pause' }, pauseFace(false));
  private pauseEl = el('div', { class: 'pause-layer', hidden: '' });
  // Share the game so far, any time after the first round (the round in play pauses meanwhile).
  private shareBtn = el('button', { type: 'button', class: 'hud-btn share-btn', title: 'The game so far, to share (after the first round)', disabled: '' }, 'Status');
  private roundEl = el('span');
  private tierEl = el('span', { class: 'tier' });
  private wordEl = el('span', { class: 'word' });
  // The ring timer: a ring that empties clockwise around the seconds left.
  private timerEl = el('span', { class: 'timer' });
  private timerBar = el('div', { class: 'ring', title: 'Seconds left' }, [ringSvg(), this.timerEl]);
  private paper = el('div', { class: 'paper' });
  private lastBeat = '';
  /** Drawings guessed, as a badge above the paper, beside the word (like the bots' wins badges). */
  private correctEl = el('span', { class: 'paper-badge' });
  private hint = el('div', { class: 'hint', 'aria-hidden': 'true' }, 'Draw here! The clock starts when the bots start guessing ✏️');
  // Round end: a bar under the paper, so nothing covers the doodle.
  private resultBar = el('div', { class: 'result-bar', hidden: '', role: 'status' });
  private padWrap = el('div', { class: 'pad-wrap' });
  /** The field's rows, kept in score order: the bot with the most right guesses on top. */
  private rowsEl = el('div', { class: 'rows' });

  // Bot-doodler mode
  private sketcher: Sketcher | null = null;
  private sketchTimer = 0;
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
    private configs: GuesserConfig[],
    onDone: (r: GameResult) => void,
    doodlerConfig: GuesserConfig | null = null,
    /** Tests can pass a fixed word list. */
    words?: Word[],
  ) {
    this.canvas = new DrawingCanvas(el('canvas', { class: 'pad' }) as HTMLCanvasElement);
    this.botDraws = !!doodlerConfig;
    this.engine = new Engine({
      bots: (fake) => configs.map((c) => ({ guesser: createGuesser(c, fake), price: priceFor(c) })),
      board: this.canvas,
      words,
      doodler: doodlerConfig ? { doodler: createDoodler(doodlerConfig), price: priceFor(doodlerConfig) } : undefined,
      events: {
        roundStart: (round, word, tier) => this.onRoundStart(round, word, tier),
        tick: (left, running) => this.onTick(left, running),
        snapshot: (image, players) => debugImage(`Snapshot → ${players.map((i) => this.engine.players[i].label).join(', ')}`, image),
        badge: (i, text, kind, detail) => this.setBadge(i, text, kind, detail),
        guess: (i, entry) => this.onGuess(i, entry),
        // Counted when a request is sent, so a slow bot whose call gets cancelled still shows "1 call".
        usage: (i) => this.views[i]?.row.setCalls(this.engine.players[i].roundCalls),
        doodleStatus: (status, message) => this.onDoodleStatus(status, message),
        sketch: (doodle) => {
          this.sketchEl.hidden = true;
          this.sketcher = new Sketcher(this.canvas, doodle.strokes);
          if (this.youGuess) this.guessInput.focus({ preventScroll: true });
          this.startSketchTimer();
        },
        roundEnding: () => this.sketcher?.tick(Infinity), // show the whole doodle at the reveal and in the share card
        roundEnd: (result, round) => this.onRoundEnd(result, round),
        pause: (paused) => this.onPause(paused),
        finish: (result) => {
          this.stopSketchTimer();
          onDone(result);
        },
        log: (kind, message, data) => debug(kind, message, data),
      },
    });
    this.views = this.engine.players.map(() => ({
      row: null as unknown as FieldRow, // built in render()
      scoreEl: el('span', { class: 'score', title: 'Rounds won' }, '0'),
      badgeEl: el('span', { class: 'badge', hidden: '' }),
      feedEl: el('ol', { class: 'feed', 'data-empty': 'ready' }),
    }));
    this.render();
    this.engine.start();
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
    const skip = () => tool('Skip', () => this.engine.skip(), 'tool ghost', '⏭');

    // No right-click menu anywhere on the paper: the canvas and the pop-ups over it (reveal, pause, sketching).
    this.paper.addEventListener('contextmenu', (e) => e.preventDefault());
    this.paper.replaceChildren(...tapes(), this.canvas.el, this.sketchEl);
    this.showCorrect();
    if (!hintSeen() && !this.botDraws) {
      this.paper.append(this.hint);
      this.canvas.el.addEventListener('pointerdown', () => this.hideHint(), { once: true });
    }
    const stop = el('button', { type: 'button', class: 'hud-btn stop', title: 'Stop the game and see the results' }, 'Stop');
    stop.addEventListener('click', () => {
      if (confirm('Stop the game and see the results so far?')) this.engine.stop();
    });
    this.shareBtn.addEventListener('click', () => {
      const pauseHere = !this.engine.roundOver && !this.engine.paused;
      if (pauseHere) this.engine.pause();
      openShareDialog(this.engine.resultSoFar(), () => pauseHere && this.engine.paused && this.engine.resume());
    });
    const togglePause = () => (this.engine.paused ? this.engine.resume() : this.engine.pause());
    this.pauseBtn.addEventListener('click', togglePause);
    // P pauses / resumes; Enter starts the next round once this one is over (unless you're typing,
    // a button has focus and handles Enter itself, or the share dialog is open).
    const onKey = (e: KeyboardEvent) => {
      if (!this.paper.isConnected) return document.removeEventListener('keydown', onKey);
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select')) return;
      if (e.key.toLowerCase() === 'p') {
        e.preventDefault();
        togglePause();
      } else if (e.key === 'Enter' && this.engine.roundOver && !this.engine.paused && !target?.closest('button') && !document.querySelector('.share-backdrop')) {
        e.preventDefault();
        this.engine.nextRound();
      }
    };
    document.addEventListener('keydown', onKey);
    this.paper.append(this.pauseEl);
    this.container.replaceChildren(
      el('section', { class: this.botDraws ? 'game bot-draws' : 'game' }, [
        // The clock and the buttons; the round and the word sit down on the canvas.
        el('header', { class: 'hud' }, [
          el('div', { class: 'hud-right' }, [el('div', { class: 'clock' }, this.timerBar), this.pauseBtn, this.shareBtn, stop]),
        ]),
        el('div', { class: 'board' }, [
          (this.padWrap.replaceChildren(
            // Right on top of the canvas: the round and level, the word, then your "N correct".
            el('div', { class: 'paper-head' }, [
              el('div', { class: 'round' }, [this.roundEl, this.tierEl]),
              // Just the word; the title says what it is for.
              el('div', { class: 'prompt', title: this.botDraws ? (this.youGuess ? 'The word to guess' : 'The word the bot is drawing') : 'The word to draw' }, [
                this.wordEl,
              ]),
              this.correctEl,
            ]),
            this.paper,
            this.resultBar,
            this.botDraws
              ? this.youGuess
                ? this.guessForm(skip())
                : el('div', { class: 'tools' }, [skip()]) // you watch: just Skip
              : el('div', { class: 'tools' }, [
                  pen,
                  eraser,
                  tool('Undo', () => this.canvas.undo(), 'tool', undoArrow()),
                  tool('Clear', () => this.canvas.clear(), 'tool', trash()),
                  skip(),
                ]),
          ),
          this.padWrap),
          el('aside', { class: 'field' }, [
            el('h2', { class: 'field-title' }, 'The field'),
            // Rows, in score order (all level at the start: engine order).
            (this.rowsEl.className = this.engine.players.length > 3 ? 'rows many' : 'rows', // many: compact on phones
            this.rowsEl.replaceChildren(
              ...this.engine.players.map((p, i) => {
                const v = this.views[i];
                v.row = new FieldRow(i, p.label, [v.badgeEl, v.feedEl], v.scoreEl, p.human ? you() : undefined, p.human ? null : providerName(this.configs[i]));
                this.setBadge(i, '', '');
                return v.row.el;
              }),
            ),
            this.rowsEl),
            ...(this.engine.doodler ? [doodlerRow(this.engine.doodler.label)] : []),
          ]),
        ]),
      ]),
    );
  }

  /** A bot draws and you guess along (the engine's youGuess): your text box, unless you just watch. */
  private get youGuess(): boolean {
    return this.engine.humanIndex >= 0;
  }

  /** Bot-doodler mode with youGuess: a text box for your guesses, plus Skip. */
  private guessForm(skip: HTMLElement): HTMLElement {
    const form = el('form', { class: 'guess-form' }, [
      this.guessInput,
      el('button', { type: 'submit', class: 'primary' }, 'Guess!'),
      skip,
    ]) as HTMLFormElement;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (this.engine.submitGuess(this.guessInput.value)) this.guessInput.value = '';
    });
    return form;
  }

  // --- Engine events -----------------------------------------------------------------------

  private onRoundStart(round: number, word: Word, tier: Tier) {
    this.resultBar.hidden = true;
    this.padWrap.classList.remove('round-over');
    this.canvas.clear();
    this.canvas.setEnabled(!this.botDraws);
    this.sketcher = null;
    this.stopSketchTimer();
    this.guessInput.value = '';
    sfx.roundStart();
    this.roundEl.replaceChildren(el('span', { class: 'round-word' }, 'Round '), `${round + 1}/${ROUNDS}`); // phones show just "3/10"
    this.tierEl.textContent = tier;
    this.tierEl.className = `tier ${tier}`;
    this.wordEl.textContent = this.youGuess ? '???' : word.word; // watching a bot draw, you see the word
    for (const v of this.views) {
      v.feedEl.replaceChildren();
      v.feedEl.dataset.empty = 'ready';
      v.row.reset();
    }
  }

  private onTick(left: number, running: boolean) {
    this.timerBar.parentElement?.classList.toggle('waiting', !running);
    this.timerEl.textContent = String(Math.ceil(left / 1000));
    this.timerBar.style.setProperty('--left', String(left / ROUND_MS));
    this.timerBar.classList.toggle('low', left < 8000);
    // Tick-tock in the last 5 s, twice as fast in the last 3.
    if (left > 0 && left <= 5000 && !sfx.reducedMotion()) {
      const n = left <= 3000 ? Math.ceil(left / 500) : Math.ceil(left / 1000);
      const beat = `${left <= 3000 ? 'h' : 's'}${n}`;
      if (beat !== this.lastBeat) sfx.tick(n % 2 === 0);
      this.lastBeat = beat;
    }
  }

  private onGuess(i: number, entry: GuessEntry) {
    // No sound per guess: with the bots guessing every few seconds it was too much. Only the
    // round's ding / wah-wah and the countdown ticks play.
    this.views[i].feedEl.prepend(
      el('li', { class: entry.right ? 'right' : 'nope' }, [
        el('span', { class: 'guess' }, entry.guess),
        el('span', { class: 'when' }, [entry.confidence === null ? '' : el('span', { class: 'conf' }, `${entry.confidence}%`), `${entry.secs}s`]),
      ]),
    );
  }

  private onDoodleStatus(status: 'sketching' | 'failed', message?: string) {
    this.sketchEl.replaceChildren(
      el(
        'div',
        { class: 'reveal card' },
        status === 'sketching'
          ? [el('p', { class: 'kicker' }, `✏️ ${this.engine.doodler?.label} is sketching…`)]
          : [el('h2', {}, 'The doodler got stuck 😵'), el('p', {}, `${message}. Skipping this round…`)],
      ),
    );
    this.sketchEl.hidden = false;
  }

  private onRoundEnd(result: RoundResult, round: number) {
    const { winner, seconds, word } = result;
    this.stopSketchTimer();
    this.canvas.setEnabled(false);
    this.hint.remove();
    this.sketchEl.hidden = true;
    this.wordEl.textContent = word;
    const players = this.engine.players;
    if (winner !== null) {
      this.views[winner].scoreEl.textContent = String(players[winner].score);
      this.showCorrect();
      replay(this.correctEl, 'bump');
      sfx.ding();
      confetti(this.paper);
      this.views[winner].row.win(players[winner].score);
      this.orderField(!sfx.reducedMotion()); // rows by right guesses: the leader rises to the top
    } else {
      sfx.wahWah();
      for (const v of this.views) v.row.shrug();
    }

    this.shareBtn.removeAttribute('disabled');
    this.shareBtn.title = 'The game so far, to share';

    // The next round starts only when you click (or press Enter on the focused button).
    const last = round === ROUNDS - 1;
    const next = el('button', { class: 'primary next-round' }, last ? 'See results 🏆' : ['Next word ', el('span', { 'aria-hidden': 'true' }, '→')]);
    next.addEventListener('click', () => this.engine.nextRound());
    const who = winner === null ? null : players[winner];

    // The bar under the paper (where the tools were): who got it, then Next.
    const name = who ? (who.human ? 'You' : shortName(who.label, 40)) : '';
    this.resultBar.replaceChildren(
      el('div', { class: 'result-avatar', 'aria-hidden': 'true' }, who ? (who.human ? you() : robot(winner!)) : '🤷'),
      el('div', { class: 'result-text' }, who
        ? [el('strong', {}, [el('span', { class: 'winner-name', style: `--who: ${this.rowColor(winner!)}` }, name), ` got it in ${seconds!.toFixed(1)} secs`])] // the tally is on the row's badge
        : [el('strong', {}, 'Nobody got it'), el('span', {}, `It was “${word}”`)]),
      el('div', { class: 'result-actions' }, next),
    );
    this.resultBar.classList.toggle('missed', !who);
    this.resultBar.hidden = false;
    this.padWrap.classList.add('round-over');
    next.focus({ preventScroll: true });
    // On a phone the bar can sit below the fold: bring it (and Next) into view once it has popped in
    // (measured mid-animation it is still small, and the scroll falls short).
    const reveal = () => this.resultBar.scrollIntoView?.({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    setTimeout(reveal, 400); // the pop-in takes 0.35s
  }

  /** "5 correct": drawings guessed so far (the doodler bot's, when a bot draws). */
  private showCorrect() {
    const n = this.engine.playerScore;
    this.correctEl.textContent = `${this.botDraws ? 'Doodler: ' : ''}${n} correct`;
    this.correctEl.title = this.botDraws ? 'The doodler bot’s drawings that got guessed' : 'Your drawings that got guessed';
    this.correctEl.classList.toggle('scored', n > 0);
  }

  /** The bot's own color, read off its row, so its name matches its row. */
  private rowColor(i: number): string {
    return getComputedStyle(this.views[i].row.el).getPropertyValue('--lane').trim() || 'var(--grape)';
  }

  /**
   * Put the field's rows in score order: the bot with the most right guesses on top. Ties keep their
   * places. With animate, the rows slide to their new spots (FLIP: measure, move in the DOM, then
   * animate from the old spot back to none).
   */
  private orderField(animate: boolean) {
    const rows = this.engine.players.map((p, i) => ({ i, el: this.views[i].row.el, score: p.score }));
    const before = new Map(rows.map((r) => [r.el, r.el.getBoundingClientRect().top]));
    rows.sort((a, b) => b.score - a.score || a.i - b.i);
    this.rowsEl.replaceChildren(...rows.map((r) => r.el));
    if (!animate) return;
    for (const r of rows) {
      const dy = (before.get(r.el) ?? 0) - r.el.getBoundingClientRect().top;
      if (dy && typeof r.el.animate === 'function') {
        r.el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 450, easing: 'cubic-bezier(0.3, 1.25, 0.5, 1)' });
      }
    }
  }

  private onPause(paused: boolean) {
    const playing = !this.engine.roundOver;
    if (paused) {
      this.stopSketchTimer();
      if (playing) this.canvas.setEnabled(false);
      this.pauseBtn.replaceChildren(...pauseFace(true));
      this.pauseBtn.setAttribute('aria-label', 'Resume');
      this.pauseBtn.title = 'Resume (P)';
      this.renderPauseCard();
    } else {
      if (playing) {
        this.canvas.setEnabled(!this.botDraws);
        this.startSketchTimer(); // carry on drawing where it paused
      }
      this.pauseBtn.replaceChildren(...pauseFace(false));
      this.pauseBtn.setAttribute('aria-label', 'Pause');
      this.pauseBtn.title = 'Pause and see this round’s guesses (P)';
    }
    this.pauseEl.hidden = !paused;
    this.paper.closest('.game')?.classList.toggle('paused', paused);
  }

  // --- Widgets -------------------------------------------------------------------------------

  /** The pause screen: every guess so far this round, one column per guesser. */
  private renderPauseCard() {
    const resume = el('button', { type: 'button', class: 'primary big' }, this.botDraws ? (this.youGuess ? 'Keep guessing!' : 'Keep watching!') : 'Keep drawing!');
    resume.addEventListener('click', () => this.engine.resume());
    const players = this.engine.players;
    const total = players.reduce((n, p) => n + p.history.length, 0);
    const word = this.engine.roundOver || !this.youGuess ? this.engine.word.word : '???';
    const columns = players.map((p, i) => {
      const col = el('div', { class: `pause-col${p.human ? ' human' : ''}` }, [
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
      ]);
      if (!p.human) col.style.setProperty('--lane', botColor(i));
      return col;
    });
    this.pauseEl.replaceChildren(
      el('div', { class: 'reveal card pause-card' }, [
        el('h2', {}, 'Paused ☕'),
        el('p', { class: 'kicker' }, [`Round ${this.engine.round + 1} · `, el('strong', {}, word), ` · ${total} guess${total === 1 ? '' : 'es'} so far`]),
        el('div', { class: 'pause-cols' }, columns),
        resume,
      ]),
    );
    resume.focus({ preventScroll: true });
  }

  /**
   * A bot's status chip: only a warning or an error shows anything. While a bot is being asked it
   * just bounces (the row's "thinking" class) and an idle bot is still.
   */
  private setBadge(i: number, text: string, kind: BadgeKind, detail = '') {
    const v = this.views[i];
    const thinking = kind === 'thinking';
    // Before its first guess, a row says where the bot is: ready, waiting (asked, no answer yet), or
    // cancelled (the round ended while it was still waiting).
    const wasThinking = v.row.el.classList.contains('thinking');
    v.feedEl.dataset.empty = thinking ? 'waiting' : wasThinking && this.engine.roundOver ? 'cancelled' : 'ready';
    v.badgeEl.className = `badge ${kind}`;
    v.badgeEl.title = thinking ? '' : detail;
    v.badgeEl.textContent = thinking ? '' : text;
    v.badgeEl.removeAttribute('aria-label');
    v.badgeEl.hidden = thinking || !text;
    v.row.setThinking(thinking);
  }

  /**
   * Animate on a timer rather than requestAnimationFrame: rAF stops in background tabs, which would
   * freeze the drawing while the round clock keeps running. Progress follows elapsed time, so a
   * throttled timer just draws in bigger steps.
   */
  private startSketchTimer() {
    this.stopSketchTimer();
    if (!this.sketcher || this.sketcher.done) return;
    let last = performance.now();
    this.sketchTimer = window.setInterval(() => {
      const now = performance.now();
      this.sketcher?.tick(now - last);
      last = now;
      if (!this.sketcher || this.sketcher.done) this.stopSketchTimer();
    }, 40);
  }

  private stopSketchTimer() {
    window.clearInterval(this.sketchTimer);
    this.sketchTimer = 0;
  }

  private hideHint() {
    this.hint.remove();
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      // storage blocked: the hint just shows again next time
    }
  }
}

/** The pause button's face: an icon, and a label that phones hide. */
function pauseFace(paused: boolean): Node[] {
  return [
    el('span', { 'aria-hidden': 'true' }, paused ? '▶' : '⏸'),
    el('span', { class: 'pause-label', 'aria-hidden': 'true' }, paused ? ' Resume' : ' Pause'),
  ];
}

/** The ring's track and its arc; pathLength 100 lets CSS empty it with --left (1 → 0). */
function ringSvg(): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('aria-hidden', 'true');
  for (const cls of ['ring-track', 'ring-arc']) {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('class', cls);
    c.setAttribute('cx', '24');
    c.setAttribute('cy', '24');
    c.setAttribute('r', '20');
    c.setAttribute('pathLength', '100');
    svg.append(c);
  }
  return svg;
}

