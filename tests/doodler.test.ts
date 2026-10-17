import { describe, expect, it, vi } from 'vitest';
import type { DrawingCanvas } from '../src/canvas';
import { cleanStrokes, createDoodler, parseStrokes, Sketcher } from '../src/doodler';
import { GuessError } from '../src/providers/types';

describe('parseStrokes: the doodler’s JSON drawing', () => {
  it('reads {"strokes": [[[x,y],…],…]}', () => {
    const strokes = parseStrokes('{"strokes": [[[10,10],[100,100]], [[0,0],[5,5],[9,9]]]}');
    expect(strokes).toHaveLength(2);
    expect(strokes[1]).toEqual([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 9, y: 9 }]);
  });

  it('finds the JSON inside chatty replies and code fences', () => {
    expect(parseStrokes('Sure!\n```json\n{"strokes": [[[1,2],[3,4]]]}\n```\nEnjoy')).toHaveLength(1);
  });

  it('accepts a bare array and {x,y} points', () => {
    expect(parseStrokes('[[[1,2],[3,4]]]')[0][0]).toEqual({ x: 1, y: 2 });
    expect(parseStrokes('{"strokes": [[{"x": 5, "y": 6}]]}')[0][0]).toEqual({ x: 5, y: 6 });
  });

  it('clamps points to the 512 × 512 canvas', () => {
    expect(parseStrokes('{"strokes": [[[900,-50],[256,256]]]}')[0][0]).toEqual({ x: 512, y: 0 });
  });

  it.each([
    ['I cannot draw that.', /didn’t send a drawing/],
    ['{"strokes": [[[1,2],[3,', /garbled/],
    ['{"strokes": []}', /empty/],
    ['{"lines": []}', /no strokes/],
  ])('rejects %j', (text, message) => {
    expect(() => parseStrokes(text)).toThrow(GuessError);
    expect(() => parseStrokes(text)).toThrow(message);
  });
});

describe('cleanStrokes', () => {
  it('drops bad points and empty strokes', () => {
    const strokes = cleanStrokes([[[1, 2], ['a', 3], [null, null], [4, 5]], [], 'nope', [[6, 7]]]);
    expect(strokes).toEqual([[{ x: 1, y: 2 }, { x: 4, y: 5 }], [{ x: 6, y: 7 }]]);
  });

  it('caps runaway drawings (40 strokes, 2500 points)', () => {
    const many = Array.from({ length: 100 }, () => [[1, 1], [2, 2]]);
    expect(cleanStrokes(many)).toHaveLength(40);
    const huge = [Array.from({ length: 5000 }, (_, i) => [i % 512, 1])];
    expect(cleanStrokes(huge)[0].length).toBeLessThanOrEqual(2501);
  });
});

/** Records the strokes a Sketcher draws. */
function recordingCanvas() {
  const strokes: { x: number; y: number }[][] = [];
  const canvas = {
    beginStroke: (p: { x: number; y: number }) => strokes.push([p]),
    extendStroke: (p: { x: number; y: number }) => strokes.at(-1)!.push(p),
  };
  return { canvas: canvas as unknown as DrawingCanvas, strokes };
}

describe('Sketcher: animating a doodle', () => {
  const line = [[{ x: 0, y: 0 }, { x: 200, y: 0 }], [{ x: 10, y: 10 }]];

  it('draws a little at a time, in stroke order, and finishes', () => {
    const { canvas, strokes } = recordingCanvas();
    const s = new Sketcher(canvas, line);
    expect(s.duration).toBeGreaterThanOrEqual(8000);
    expect(s.duration).toBeLessThanOrEqual(15000);
    s.tick(s.duration / 4);
    expect(s.done).toBe(false);
    expect(strokes).toHaveLength(1);
    s.tick(s.duration);
    expect(s.done).toBe(true);
    expect(strokes).toHaveLength(2);
    expect(strokes[0].at(-1)).toEqual({ x: 200, y: 0 });
  });

  it('fills in long lines so they grow smoothly', () => {
    const { canvas, strokes } = recordingCanvas();
    new Sketcher(canvas, line).tick(Infinity);
    expect(strokes[0].length).toBeGreaterThan(10); // 200 px line → points every ~10 px
  });

  it('tick(Infinity) finishes at once (used at the reveal)', () => {
    const { canvas } = recordingCanvas();
    const s = new Sketcher(canvas, line);
    s.tick(Infinity);
    expect(s.done).toBe(true);
  });
});

describe('fake doodler', () => {
  it('draws known words from its library, and something for any word', async () => {
    vi.useFakeTimers();
    const doodler = createDoodler({ kind: 'fake' });
    expect(doodler.label).toBe('Fake doodler');
    const sun = doodler.draw('sun', new AbortController().signal);
    await vi.advanceTimersByTimeAsync(2000);
    expect((await sun).strokes.length).toBe(9); // a circle and 8 rays
    const other = doodler.draw('quantum computer', new AbortController().signal);
    await vi.advanceTimersByTimeAsync(2000);
    expect((await other).strokes.length).toBeGreaterThan(0);
  });

  it('stops when cancelled', async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const p = createDoodler({ kind: 'fake' }).draw('sun', ac.signal);
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});
