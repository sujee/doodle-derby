/** Test helpers: a hand-cranked clock, a fake drawing board, and bots that answer on cue. */

import type { Board, Clock, EngineEvents } from '../src/engine';
import type { GuessRequest, GuessResult, Guesser } from '../src/providers/types';
import type { Word } from '../src/words';

/** Let pending promise callbacks run (several rounds of microtasks). */
export async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** A clock that only moves when the test says so. Timers fire in time order; promises settle in between. */
export class FakeClock implements Clock {
  private t = 0;
  private nextId = 1;
  private timers = new Map<number, { at: number; every: number | null; fn: () => void }>();

  now() {
    return this.t;
  }

  setInterval(fn: () => void, ms: number) {
    const id = this.nextId++;
    this.timers.set(id, { at: this.t + ms, every: ms, fn });
    return id;
  }

  setTimeout(fn: () => void, ms: number) {
    const id = this.nextId++;
    this.timers.set(id, { at: this.t + ms, every: null, fn });
    return id;
  }

  clearInterval(id: number) {
    this.timers.delete(id);
  }

  /** Move time forward, firing due timers one by one (and letting promises settle after each). */
  async advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      let nextId = -1;
      let next: { at: number; every: number | null; fn: () => void } | undefined;
      for (const [id, timer] of this.timers) {
        if (timer.at <= end && (!next || timer.at < next.at)) {
          next = timer;
          nextId = id;
        }
      }
      if (!next) break;
      this.t = next.at;
      if (next.every === null) this.timers.delete(nextId);
      else next.at += next.every;
      next.fn();
      await flush();
    }
    this.t = end;
    await flush();
  }

  get pendingTimers() {
    return this.timers.size;
  }
}

/** A drawing board: draw() makes it non-empty and bumps its version, like a stroke would. */
export class FakeBoard implements Board {
  changeVersion = 0;
  strokes = 0;
  snapshots = 0;

  get isEmpty() {
    return this.strokes === 0;
  }

  draw() {
    this.strokes++;
    this.changeVersion++;
  }

  clear() {
    this.strokes = 0;
    this.changeVersion++;
  }

  snapshot() {
    this.snapshots++;
    return `data:image/jpeg;base64,SNAPSHOT${this.changeVersion}`;
  }
}

type Reply = GuessResult | Error | ((req: GuessRequest) => GuessResult | Error | Promise<GuessResult>);

/**
 * A bot whose answers are scripted. Each call takes the next reply from the queue (the last one
 * repeats). With `hold`, replies wait until release() so tests can see requests in flight.
 */
export class ScriptedBot implements Guesser {
  requests: GuessRequest[] = [];
  private held: { resolve: () => void }[] = [];

  constructor(
    readonly label: string,
    private replies: Reply[] = [{ guess: 'nothing', confidence: 10 }],
    private opts: { hold?: boolean } = {},
  ) {}

  async guess(req: GuessRequest): Promise<GuessResult> {
    this.requests.push({ ...req, wrongGuesses: [...req.wrongGuesses] });
    const reply = this.replies.length > 1 ? this.replies.shift()! : this.replies[0];
    if (this.opts.hold) {
      await new Promise<void>((resolve, reject) => {
        this.held.push({ resolve });
        req.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    }
    if (req.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const value = typeof reply === 'function' ? await reply(req) : reply;
    if (value instanceof Error) throw value;
    return value;
  }

  /** Let every held reply through. */
  release() {
    this.held.splice(0).forEach((h) => h.resolve());
  }

  get calls() {
    return this.requests.length;
  }
}

const EVENT_NAMES = [
  'roundStart', 'tick', 'snapshot', 'badge', 'guess', 'usage', 'doodlerUsage', 'doodleStatus',
  'sketch', 'roundEnding', 'roundEnd', 'pause', 'finish', 'log',
] as const satisfies readonly (keyof EngineEvents)[];

/** Record every event the engine emits, in order. */
export function recordEvents(): { events: EngineEvents; log: { name: string; args: unknown[] }[]; names: () => string[] } {
  const log: { name: string; args: unknown[] }[] = [];
  const events: Record<string, (...args: unknown[]) => void> = {};
  for (const name of EVENT_NAMES) events[name] = (...args) => log.push({ name, args });
  return { events: events as EngineEvents, log, names: () => log.map((e) => e.name) };
}

/** Ten simple words, so tests know the answers. */
export const WORDS: Word[] = ['cat', 'sun', 'hat', 'fish', 'tree', 'bicycle', 'guitar', 'bird', 'lighthouse', 'octopus'].map((word) => ({ word }));
