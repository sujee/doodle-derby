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
  const lane = container.querySelector<HTMLElement>('.lane')!;
  return {
    game,
    badge: lane.querySelector<HTMLElement>('.badge')!,
    feed: lane.querySelector<HTMLElement>('.feed')!,
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
    draw();
    await vi.advanceTimersByTimeAsync(POLL_MS); // the Fake guesser is asked and takes 0.6–2 s to answer
    expect(game.engine.players[0].inFlight).toBe(true);
    expect(badge.classList.contains('thinking')).toBe(true);

    game.engine.skip();
    await flush();
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe('cancelled');
    expect(badge.classList.contains('cancelled')).toBe(true);
    // The CSS that hides "zzz…" under the badge needs the empty feed right after it.
    expect(feed.children).toHaveLength(0);
    expect(badge.nextElementSibling).toBe(feed);

    game.engine.nextRound();
    expect(badge.hidden).toBe(true);
    expect(badge.classList.contains('cancelled')).toBe(false);
    game.engine.stop();
  });

  it('a bot that answered before the round ended shows no badge', async () => {
    const { game, badge, draw } = startGame();
    draw();
    await vi.advanceTimersByTimeAsync(POLL_MS + 2500); // asked, and answered (at most 2 s)
    expect(game.engine.players[0].inFlight).toBe(false);
    if (!game.engine.roundOver) game.engine.skip();
    await flush();
    expect(badge.hidden).toBe(true);
    game.engine.stop();
  });
});
