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
  it('just goes back to idle (no chip, no "cancelled" badge)', async () => {
    const { game, badge, feed, draw } = startGame();
    expect(badge.hidden).toBe(true); // idle before anything is asked: no chip at all
    draw();
    await vi.advanceTimersByTimeAsync(POLL_MS); // the Fake guesser is asked and takes 0.6–2 s to answer
    expect(game.engine.players[0].inFlight).toBe(true);
    expect(badge.hidden).toBe(true); // no chip: the bot just bounces
    expect(container.querySelector('.field-row')!.classList.contains('thinking')).toBe(true);

    game.engine.skip();
    await flush();
    expect(badge.hidden).toBe(true);
    expect(badge.textContent).toBe('');
    expect(feed.children).toHaveLength(0);
    game.engine.stop();
  });

  it('a bot that answered before the round ended goes back to idle', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // the Fake guesser gets it right, ending the round
    const { game, badge, draw } = startGame();
    draw();
    await vi.advanceTimersByTimeAsync(POLL_MS + 2500); // asked, and answered (at most 2 s)
    expect(game.engine.roundOver).toBe(true);
    expect(game.engine.players[0].inFlight).toBe(false);
    vi.restoreAllMocks();
    await flush();
    expect(badge.hidden).toBe(true);
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

describe('Status in the game controls', () => {
  it('shows the standings so far (calls and tokens too), pausing a round in play', async () => {
    const { game } = startGame();
    const status = container.querySelector<HTMLButtonElement>('.share-btn')!;
    expect(status.disabled).toBe(false); // standings are there from the start
    status.click();
    const dialog = document.querySelector('.status-dialog')!;
    expect(dialog.querySelector('h2')!.textContent).toBe('Standings · round 1/10');
    expect(dialog.querySelectorAll('.tally tbody tr')).toHaveLength(game.engine.players.length);
    expect(dialog.textContent).toContain('API calls');
    expect(dialog.querySelector('.share-actions')).toBeNull(); // nothing to share before a round is done
    document.querySelector<HTMLButtonElement>('.share-close')!.click();
    expect(document.querySelector('.status-dialog')).toBeNull();
    game.engine.stop();
  });

  it('after a round, Share opens the share cards; closing them resumes the game', async () => {
    const { game } = startGame();
    game.engine.skip();
    await flush();
    game.engine.nextRound();
    container.querySelector<HTMLButtonElement>('.share-btn')!.click();
    expect(game.engine.paused).toBe(true);
    document.querySelector<HTMLButtonElement>('.status-dialog .share-actions button')!.click();
    expect(document.querySelector('.status-dialog')).toBeNull();
    expect(document.querySelector('.share-dialog')).not.toBeNull();
    document.querySelector<HTMLButtonElement>('.share-close')!.click();
    expect(game.engine.paused).toBe(false);
    game.engine.stop();
  });
});

describe('the word and the "N correct" badge above the paper', () => {
  it('counts your drawings that got guessed', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // the Fake guesser gets it right
    const { game, draw } = startGame();
    const badge = container.querySelector<HTMLElement>('.paper-head .paper-badge')!;
    expect(badge.textContent).toBe('0 correct');
    expect(container.querySelector('.paper-head .word')!.textContent).toBe(game.engine.word.word); // just the word
    expect(container.textContent).not.toContain('Your turn');
    draw();
    await vi.advanceTimersByTimeAsync(POLL_MS + 2500);
    expect(game.engine.roundOver).toBe(true);
    expect(badge.textContent).toBe('1 correct');
    expect(badge.classList.contains('scored')).toBe(true);
    game.engine.stop();
    vi.restoreAllMocks();
  });
});

describe('Enter after a round', () => {
  it('starts the next round, but not mid-round', async () => {
    const { game } = startGame();
    const enter = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    enter();
    expect(game.engine.round).toBe(0); // still drawing: nothing happens
    game.engine.skip();
    await flush();
    enter();
    expect(game.engine.round).toBe(1);
    expect(game.engine.roundOver).toBe(false);
    game.engine.stop();
  });
});

describe('the call count at the right of a row', () => {
  it('counts the calls the bot has made this round', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // the Fake guesser gets it right on the first try
    const { game, draw } = startGame();
    const count = container.querySelector<HTMLElement>('.field-row .row-guess-count')!;
    expect(count.textContent).toBe(''); // nothing yet
    expect(container.querySelector('.field-row .meter')).toBeNull(); // the token meter is gone
    draw();
    await vi.advanceTimersByTimeAsync(POLL_MS + 50);
    expect(game.engine.roundOver).toBe(false);
    expect(count.textContent).toBe('1 call'); // counted when sent, before any answer (or a cancel)
    await vi.advanceTimersByTimeAsync(2500);
    expect(game.engine.roundOver).toBe(true);
    expect(count.textContent).toBe('1 call');
    vi.restoreAllMocks();
    game.engine.stop();
  });
});

describe('the provider on the field', () => {
  const on = (baseUrl: string) => ({ kind: 'openai' as const, apiKey: 'k', model: 'm', baseUrl });
  const fireworks = 'https://api.fireworks.ai/inference/v1';
  const together = 'https://api.together.xyz/v1';
  const tags = () => [...container.querySelectorAll('.field-row .row-provider')].map((t) => t.textContent);

  it('is said once in the title when every bot uses it, and left off the rows', () => {
    const game = new Game(container, [on(fireworks), on(fireworks)], () => {}, null, WORDS);
    expect(container.querySelector('.field-title')!.textContent).toBe('All models on Fireworks');
    expect(tags()).toEqual([]);
    expect(container.querySelector('.field-row h3')!.getAttribute('title')).toContain('Fireworks'); // still there on hover
    game.engine.stop();
  });

  it('is a small tag on each row when the bots differ, with nothing on the title', () => {
    const game = new Game(container, [on(fireworks), on(together)], () => {}, null, WORDS);
    expect(container.querySelector('.field-title')!.textContent).toBe('The field');
    expect(tags()).toEqual(['Fireworks', 'Together']);
    game.engine.stop();
  });

  it('is not claimed when a Fake guesser is among the real ones', () => {
    const game = new Game(container, [on(fireworks), { kind: 'fake' }], () => {}, null, WORDS);
    expect(container.querySelector('.field-title')!.textContent).toBe('The field');
    expect(tags()).toEqual(['Fireworks']);
    game.engine.stop();
  });
});

describe('the winner row', () => {
  it('shows the time of the right guess after the name, tinted by its speed, and clears it next round', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // the Fake guesser gets it right on the first try
    const { game, draw } = startGame();
    const pill = container.querySelector<HTMLElement>('.field-row .row-time')!;
    expect(pill.textContent).toBe(''); // nobody has won yet
    draw();
    await vi.advanceTimersByTimeAsync(POLL_MS + 2500);
    expect(game.engine.roundOver).toBe(true);
    expect(pill.textContent).toMatch(/^\d+\.\ds$/);
    expect(pill.className).toMatch(/\b(fast|mid|slow)\b/);
    expect(container.querySelector('.feed .when .conf')?.closest('li')?.classList.contains('right')).toBe(true); // the feed keeps its own, hidden, details
    game.engine.nextRound();
    expect(pill.textContent).toBe('');
    vi.restoreAllMocks();
    game.engine.stop();
  });
});

describe('a row before its first guess', () => {
  it('says ready, then waiting while asked, then round ended if the round ends first', async () => {
    const { game, draw } = startGame();
    const feed = container.querySelector<HTMLElement>('.field-row .feed')!;
    expect(feed.dataset.empty).toBe('ready');
    draw();
    await vi.advanceTimersByTimeAsync(POLL_MS + 50); // asked; the Fake guesser takes 600 ms or more
    expect(feed.dataset.empty).toBe('waiting');
    game.engine.skip();
    expect(feed.children).toHaveLength(0);
    expect(feed.dataset.empty).toBe('round ended');
    game.engine.stop();
  });
});

describe('the field order', () => {
  it('puts the bot with the most right guesses on top; ties keep their original order', () => {
    const game = new Game(container, [{ kind: 'fake' }, { kind: 'fake' }, { kind: 'fake' }], () => {}, null, WORDS);
    const players = game.engine.players;
    players[0].score = 1;
    players[1].score = 3;
    players[2].score = 3; // tied with #2, which keeps its place
    (game as unknown as { orderField(animate: boolean): void }).orderField(false);
    const order = [...container.querySelectorAll('.rows .field-row h3')].map((h) => h.textContent);
    expect(order).toEqual([players[1].label, players[2].label, players[0].label]);
    game.engine.stop();
  });
});
