/**
 * The game screen. The rules live in engine.ts; this class builds the DOM, wires the controls to the
 * engine, and draws whatever the engine reports (rounds, guesses, scores, pause, results).
 */

import { confetti, robot, tapes, trash, undoArrow, you } from './art';
import { DrawingCanvas } from './canvas';
import { doodlerRow, Stars, starColumn } from './climb';
import { FieldRow } from './field';
import { debug, debugImage } from './debug';
import { el } from './dom';
import { createDoodler, Sketcher } from './doodler';
import { Engine, ROUND_MS, type BadgeKind, type GameResult, type GuessEntry, type RoundResult } from './engine';
import { costOf, formatTokens, formatUsd, priceFor, type Price, type Usage } from './pricing';
import { createGuesser, providerName, type GuesserConfig } from './providers';
import { shortName, wildestGuess } from './share';
import * as sfx from './sound';
import { ROUNDS, type Tier, type Word } from './words';

export type { GameResult, RoundResult } from './engine';

const HINT_KEY = 'doodle-duel-hint-seen';

function hintSeen(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

/** Per-player widgets (same index as engine.players). */
type PlayerView = { row: FieldRow; meterEl: HTMLElement; scoreEl: HTMLElement; badgeEl: HTMLElement; feedEl: HTMLElement };

export class Game {
  readonly engine: Engine;
  private canvas: DrawingCanvas;
  private views: PlayerView[];
  private botDraws: boolean;

  private pauseBtn = el('button', { type: 'button', class: 'pause-btn', title: 'Pause and see this round’s guesses (P)' }, '⏸ Pause');
  private pauseEl = el('div', { class: 'pause-layer', hidden: '' });
  private roundEl = el('span');
  private tierEl = el('span', { class: 'tier' });
  private wordEl = el('span', { class: 'word' });
  // The ring timer: a ring that empties clockwise around the seconds left.
  private timerEl = el('span', { class: 'timer' });
  private timerBar = el('div', { class: 'ring', title: 'Seconds left' }, [ringSvg(), this.timerEl]);
  private paper = el('div', { class: 'paper' });
  private lastBeat = '';
  private youScoreEl = el('span', { class: 'sr-only' }, '0');
  private youStars = new Stars();
  private hint = el('div', { class: 'hint', 'aria-hidden': 'true' }, 'Draw here! The clock starts when the bots start guessing ✏️');
  // Round end: a bar under the paper, so nothing covers the doodle.
  private resultBar = el('div', { class: 'result-bar', hidden: '', role: 'status' });
  private padWrap = el('div', { class: 'pad-wrap' });
  /** "Wrong guess of the game": the wordiest wrong guess so far (the funny ones tend to be long). */
  private wildEl = el('div', { class: 'wild card', hidden: '', role: 'status' });
  private drawLabel = el('span', { class: 'draw-label' }, 'Your turn to draw: ');

  // Bot-doodler mode
  private doodlerMeter = el('div', { class: 'meter' });
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
        usage: (i) => this.updateMeter(i),
        doodlerUsage: () => this.updateDoodlerMeter(),
        doodleStatus: (status, message) => this.onDoodleStatus(status, message),
        sketch: (doodle) => {
          this.sketchEl.hidden = true;
          this.sketcher = new Sketcher(this.canvas, doodle.strokes);
          this.guessInput.focus({ preventScroll: true });
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
      meterEl: el('div', { class: 'meter', title: 'Tokens in / out and cost so far' }),
      scoreEl: el('span', { class: 'score', title: 'Rounds won' }, '0'),
      badgeEl: el('span', { class: 'badge', hidden: '' }),
      feedEl: el('ol', { class: 'feed' }),
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
    if (!hintSeen() && !this.botDraws) {
      this.paper.append(this.hint);
      this.canvas.el.addEventListener('pointerdown', () => this.hideHint(), { once: true });
    }
    const stop = el('button', { type: 'button', class: 'icon-btn stop', title: 'Stop game', 'aria-label': 'Stop game' }, '✕');
    stop.addEventListener('click', () => {
      if (confirm('Stop the game and see the results so far?')) this.engine.stop();
    });
    const togglePause = () => (this.engine.paused ? this.engine.resume() : this.engine.pause());
    this.pauseBtn.addEventListener('click', togglePause);
    // P pauses / resumes (unless you're typing a guess).
    const onKey = (e: KeyboardEvent) => {
      if (!this.paper.isConnected) return document.removeEventListener('keydown', onKey);
      if (e.key.toLowerCase() !== 'p' || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      e.preventDefault();
      togglePause();
    };
    document.addEventListener('keydown', onKey);
    this.paper.append(this.pauseEl);
    this.container.replaceChildren(
      el('section', { class: 'game' }, [
        el('header', { class: 'hud' }, [
          el('div', { class: 'round' }, [this.roundEl, this.tierEl]),
          el('div', { class: 'prompt' }, [this.drawLabel, this.wordEl]),
          el('div', { class: 'hud-right' }, [el('div', { class: 'clock' }, this.timerBar), this.pauseBtn, stop]),
        ]),
        el('div', { class: 'board' }, [
          (this.padWrap.replaceChildren(
            el('div', { class: 'paper-row' }, [starColumn(this.youScoreEl, this.youStars, this.botDraws), this.paper]),
            this.resultBar,
            this.botDraws
              ? this.guessForm(skip())
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
            el(
              'div',
              { class: 'rows' },
              this.engine.players.map((p, i) => {
                const v = this.views[i];
                v.row = new FieldRow(i, p.label, [v.badgeEl, v.feedEl], v.scoreEl, v.meterEl, p.human ? you() : undefined, p.human ? null : providerName(this.configs[i]));
                if (p.human) v.meterEl.textContent = 'type your guesses below';
                this.updateMeter(i);
                this.setBadge(i, '', '');
                return v.row.el;
              }),
            ),
            ...(this.engine.doodler ? [(this.updateDoodlerMeter(), doodlerRow(this.engine.doodler.label, this.doodlerMeter))] : []),
          ]),
          this.wildEl, // under the field on desktop, under the paper on phones
        ]),
      ]),
    );
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
    this.roundEl.textContent = `Round ${round + 1}/${ROUNDS}`;
    this.tierEl.textContent = tier;
    this.tierEl.className = `tier ${tier}`;
    this.wordEl.textContent = this.botDraws ? '???' : word.word;
    this.drawLabel.textContent = this.botDraws ? 'Guess the doodle: ' : 'Your turn to draw: ';
    for (const v of this.views) {
      v.feedEl.replaceChildren();
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
    sfx.pop(i);
    if (!entry.right) setTimeout(sfx.wrong, 260);
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
      this.youScoreEl.textContent = String(this.engine.playerScore);
      this.youStars.fill(this.engine.playerScore);
      sfx.ding();
      confetti(this.paper);
      this.views[winner].row.win(players[winner].score, seconds);
      this.views[winner].row.moveToTop(!sfx.reducedMotion()); // and stays there until another row wins
    } else {
      sfx.wahWah();
      for (const v of this.views) v.row.shrug();
    }

    this.renderWild();

    // The next round starts only when you click (or press Enter on the focused button).
    const last = round === ROUNDS - 1;
    const next = el('button', { class: 'primary next-round' }, last ? 'See results 🏆' : ['Next word ', el('span', { 'aria-hidden': 'true' }, '→')]);
    next.addEventListener('click', () => this.engine.nextRound());
    const who = winner === null ? null : players[winner];

    // The bar under the paper (where the tools were): who got it, then Next.
    const name = who ? (who.human ? 'You' : shortName(who.label, 40)) : '';
    const wins = who ? `(${who.score} win${who.score === 1 ? '' : 's'})` : '';
    this.resultBar.replaceChildren(
      el('div', { class: 'result-avatar', 'aria-hidden': 'true' }, who ? (who.human ? you() : robot(winner!)) : '🤷'),
      el('div', { class: 'result-text' }, who
        ? [el('strong', {}, [el('span', { class: 'winner-name', style: `--who: ${this.rowColor(winner!)}` }, name), ` got it in ${seconds!.toFixed(1)} secs `, el('span', { class: 'result-wins' }, wins)])]
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

  /** Updated at round end only: mid-round the word may be secret (a bot is drawing). */
  private renderWild() {
    const wild = wildestGuess(this.engine.resultSoFar());
    this.wildEl.hidden = !wild;
    if (!wild) return;
    const who = this.engine.players[wild.bot];
    this.wildEl.replaceChildren(
      el('p', { class: 'wild-title' }, 'Wrong guess of the game'),
      el('p', { class: 'wild-line' }, [
        el('span', { class: 'wild-word' }, wild.word),
        el('span', { class: 'wild-arrow', 'aria-hidden': 'true' }, '→'),
        el('s', { class: 'wild-guess' }, wild.guess),
      ]),
      el('p', { class: 'wild-who' }, ['by ', el('span', { class: 'winner-name', style: `--who: ${this.rowColor(wild.bot)}` }, who.human ? 'You' : shortName(who.label))]),
    );
  }

  /** The bot's own color, read off its row, so its name matches its row. */
  private rowColor(i: number): string {
    return getComputedStyle(this.views[i].row.el).getPropertyValue('--lane').trim() || 'var(--grape)';
  }

  private onPause(paused: boolean) {
    const playing = !this.engine.roundOver;
    if (paused) {
      this.stopSketchTimer();
      if (playing) this.canvas.setEnabled(false);
      this.pauseBtn.textContent = '▶ Resume';
      this.pauseBtn.title = 'Resume (P)';
      this.renderPauseCard();
    } else {
      if (playing) {
        this.canvas.setEnabled(!this.botDraws);
        this.startSketchTimer(); // carry on drawing where it paused
      }
      this.pauseBtn.textContent = '⏸ Pause';
      this.pauseBtn.title = 'Pause and see this round’s guesses (P)';
    }
    this.pauseEl.hidden = !paused;
    this.paper.closest('.game')?.classList.toggle('paused', paused);
  }

  // --- Widgets -------------------------------------------------------------------------------

  /** The pause screen: every guess so far this round, one column per guesser. */
  private renderPauseCard() {
    const resume = el('button', { type: 'button', class: 'primary big' }, this.botDraws ? 'Keep guessing!' : 'Keep drawing!');
    resume.addEventListener('click', () => this.engine.resume());
    const players = this.engine.players;
    const total = players.reduce((n, p) => n + p.history.length, 0);
    const word = this.engine.roundOver || !this.botDraws ? this.engine.word.word : '???';
    const columns = players.map((p, i) =>
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
        el('p', { class: 'kicker' }, [`Round ${this.engine.round + 1} · `, el('strong', {}, word), ` · ${total} guess${total === 1 ? '' : 'es'} so far`]),
        el('div', { class: 'pause-cols' }, columns),
        resume,
      ]),
    );
    resume.focus({ preventScroll: true });
  }

  /** A bot's status chip. With nothing to report, a bot says "ready"; while asked, "thinking…". */
  private setBadge(i: number, text: string, kind: BadgeKind, detail = '') {
    const v = this.views[i];
    const ready = !text && !this.engine.players[i].human;
    v.badgeEl.textContent = ready ? 'ready' : kind === 'thinking' ? 'thinking' : text;
    v.badgeEl.className = `badge ${ready ? 'ready' : kind}`;
    v.badgeEl.title = detail;
    v.badgeEl.hidden = !text && !ready;
    v.row.setThinking(kind === 'thinking');
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

  private updateDoodlerMeter() {
    renderMeter(this.doodlerMeter, this.engine.doodlerUsage, this.engine.doodlerPrice);
  }

  private updateMeter(i: number) {
    const p = this.engine.players[i];
    if (p.human) return; // your row keeps its "type your guesses" hint
    renderMeter(this.views[i].meterEl, p.usage, p.price);
  }
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

/** Live token meter: ↑ tokens in, ↓ tokens out, cost and calls, updated as requests go out and come back. */
export function renderMeter(meter: HTMLElement, usage: Usage, price: Price) {
  if (price.kind === 'free' && price.why === 'fake bot') {
    meter.replaceChildren(el('span', { class: 'chip quiet' }, 'fake bot · no tokens'));
    meter.title = 'The fake bot makes no API calls';
    return;
  }
  const cost = costOf(usage, price);
  const costText = price.kind === 'free' ? 'free' : cost === null ? 'price ?' : formatUsd(cost);
  meter.replaceChildren(
    el('span', { class: 'chip', title: 'Input tokens (prompt + image), as reported by the provider' }, `↑ ${formatTokens(usage.input)} in`),
    el('span', { class: 'chip', title: 'Output tokens (reply, plus any thinking)' }, `↓ ${formatTokens(usage.output)} out`),
    el('span', { class: 'chip cost', title: price.kind === 'unknown' ? 'No price known for this model' : 'Cost so far, from models.dev prices' }, costText),
    el('span', { class: 'chip quiet', title: 'Requests sent, including ones still waiting or cancelled (tokens count only answered ones)' }, `${usage.calls} call${usage.calls === 1 ? '' : 's'}`),
  );
  meter.title = `${usage.input} tokens in, ${usage.output} tokens out over ${usage.calls} calls`;
}
