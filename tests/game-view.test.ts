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
  const row = container.querySelector<HTMLElement>('.row')!;
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
    expect(badge.closest('.row')).toBe(feed.closest('.row'));

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
