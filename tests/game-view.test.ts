import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POLL_MS } from '../src/engine';
import { Game } from '../src/game';
import { flush, WORDS } from './helpers';

// The game screen with a real engine and the Fake guesser, on fake timers.

let container: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
  container = document.createElement('div');
  document.body.append(container);
});
afterEach(() => {
  container.remove();
  vi.useRealTimers();
});

function startGame() {
  const game = new Game(container, [{ kind: 'fake' }], () => {}, null, WORDS);
  const row = container.querySelector<HTMLElement>('.field-row')!;
  return {
    game,
    badge: row.querySelector<HTMLElement>('.badge')!,
    feed: row.querySelector<HTMLElement>('.feed')!,
    /** A stroke on the paper, so the bots have something to look at. */
    draw() {
      const canvas = (game as unknown as { canvas: { beginStroke(p: object): void; extendStroke(p: object): void } }).canvas;
      canvas.beginStroke({ x: 10, y: 10 });
      canvas.extendStroke({ x: 200, y: 200 });
    },
  };
}

describe('a bot whose request is cancelled when the round ends', () => {
  it('shows "cancelled" instead of the idle "zzz…", and clears next round', async () => {
    const { game, badge, feed, draw } = startGame();
    expect(badge.textContent).toBe('ready'); // before anything is asked
    draw();
    await vi.advanceTimersByTimeAsync(POLL_MS); // the Fake guesser is asked and takes 0.6–2 s to answer
    expect(game.engine.players[0].inFlight).toBe(true);
    expect(badge.classList.contains('thinking')).toBe(true);
    expect(badge.textContent).toBe('thinking');

    game.engine.skip();
    await flush();
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe('cancelled');
    expect(badge.classList.contains('cancelled')).toBe(true);
    // No guesses yet, and the row hides its "zzz…" while the badge shows (CSS :has).
    expect(feed.children).toHaveLength(0);
    expect(badge.closest('.field-row')).toBe(feed.closest('.field-row'));

    game.engine.nextRound();
    expect(badge.textContent).toBe('ready');
    expect(badge.classList.contains('cancelled')).toBe(false);
    game.engine.stop();
  });

  it('a bot that answered before the round ended is just "ready"', async () => {
    const { game, badge, draw } = startGame();
    draw();
    await vi.advanceTimersByTimeAsync(POLL_MS + 2500); // asked, and answered (at most 2 s)
    expect(game.engine.players[0].inFlight).toBe(false);
    if (!game.engine.roundOver) game.engine.skip();
    await flush();
    expect(badge.textContent).toBe('ready');
    expect(badge.className).toBe('badge ready');
    game.engine.stop();
  });
});

describe('the result bar', () => {
  it('has just Next word (sharing is on the results screen)', async () => {
    const { game } = startGame();
    game.engine.skip();
    await flush();
    const bar = container.querySelector<HTMLElement>('.result-bar')!;
    expect(bar.hidden).toBe(false);
    expect([...bar.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Next word →']);
    game.engine.stop();
  });
});

describe('the wrong guess of the game', () => {
  it('stays hidden until a round ends with a wrong guess, then shows word → guess', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // the Fake guesser misses
    const { game, draw } = startGame();
    const wild = container.querySelector<HTMLElement>('.wild')!;
    expect(wild.hidden).toBe(true);
    draw();
    await vi.advanceTimersByTimeAsync(POLL_MS + 2500); // one wrong guess in
    expect(wild.hidden).toBe(true); // not mid-round
    const guess = game.engine.players[0].history[0].guess;
    game.engine.skip();
    await flush();
    expect(wild.hidden).toBe(false);
    expect(wild.querySelector('.wild-word')!.textContent).toBe(game.engine.word.word);
    expect(wild.querySelector('.wild-guess')!.textContent).toBe(guess);
    game.engine.stop();
    vi.restoreAllMocks();
  });
});

describe('the round winner', () => {
  it('gets a wins badge, moves to the top of the field and stays there', async () => {
    const { FieldRow } = await import('../src/field');
    const list = document.createElement('div');
    container.append(list);
    const rows = [0, 1, 2].map((i) => new FieldRow(i, `bot ${i}`, [document.createElement('span'), document.createElement('ol')], document.createElement('span')));
    list.append(...rows.map((r) => r.el));
    const badge = rows[2].el.querySelector('.row-wins')!;
    expect(badge.textContent).toBe('0 wins');
    rows[2].win(1, 2.5);
    expect(badge.textContent).toBe('1 win');
    expect(badge.classList.contains('has-wins')).toBe(true);
    rows[2].moveToTop(true);
    expect([...list.children]).toEqual([rows[2].el, rows[0].el, rows[1].el]);
    rows[2].reset(); // next round: the order stays
    rows[1].moveToTop(false);
    expect([...list.children]).toEqual([rows[1].el, rows[2].el, rows[0].el]);
  });
});
