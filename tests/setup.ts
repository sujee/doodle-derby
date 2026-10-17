/**
 * jsdom has no canvas, audio or media queries. These stubs are just enough for the game's code to
 * run; tests check behaviour (state, requests, DOM), not pixels.
 */
import { afterEach, vi } from 'vitest';

class FakeContext2D {
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  lineCap = 'butt';
  lineJoin = 'miter';
  font = '';
  textAlign = 'left';
  textBaseline = 'alphabetic';
  fillRect() {}
  strokeRect() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  stroke() {}
  fill() {}
  arc() {}
  ellipse() {}
  roundRect() {}
  fillText() {}
  drawImage() {}
  save() {}
  restore() {}
  translate() {}
  rotate() {}
  setLineDash() {}
  measureText(text: string) {
    return { width: text.length * 10 };
  }
  getImageData() {
    return { data: new Uint8ClampedArray(4) };
  }
}

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value() {
    return new FakeContext2D();
  },
});
Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
  configurable: true,
  // A real 1×1 white JPEG, so code that inspects image headers has something valid.
  value: () =>
    'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
});

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// No sound in tests.
(window as unknown as { AudioContext: unknown }).AudioContext = undefined;

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});
