import { describe, expect, it } from 'vitest';
import { botColor } from '../src/art';

describe('botColor', () => {
  it('gives every bot a different colour, however many there are', () => {
    const colors = Array.from({ length: 12 }, (_, i) => botColor(i));
    expect(new Set(colors).size).toBe(colors.length);
    expect(colors[0]).toMatch(/^hsl\(/);
  });
});
