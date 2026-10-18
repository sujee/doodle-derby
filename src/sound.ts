/**
 * Synthesized sound effects (Web Audio, no files). On by default; the choice is remembered.
 * The AudioContext is only created after the first user gesture, as browsers require.
 */

const KEY = 'doodle-derby-muted';
const VOLUME = 0.22;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let unlocked = false;
let muted = readMuted();
const listeners: ((muted: boolean) => void)[] = [];

function readMuted(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function isMuted() {
  return muted;
}

export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem(KEY, m ? '1' : '0');
  } catch {
    // storage blocked: keep the choice for this tab only
  }
  listeners.forEach((fn) => fn(m));
  if (!m) boop();
}

export function onMuteChange(fn: (muted: boolean) => void) {
  listeners.push(fn);
}

function audio(): AudioContext | null {
  if (muted || !unlocked) return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = VOLUME;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

type ToneOpts = {
  type?: OscillatorType;
  to?: number; // glide to this frequency
  delay?: number;
  gain?: number;
  attack?: number;
  vibrato?: number; // depth in Hz
};

function tone(freq: number, dur: number, o: ToneOpts = {}) {
  const ac = audio();
  if (!ac || !master) return;
  const t = ac.currentTime + (o.delay ?? 0);
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
  if (o.vibrato) {
    const lfo = ac.createOscillator();
    const depth = ac.createGain();
    lfo.frequency.value = 6;
    depth.gain.value = o.vibrato;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + dur);
  }
  const peak = o.gain ?? 0.6;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + (o.attack ?? 0.01));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(dur: number, freq: number, o: { delay?: number; gain?: number; to?: number } = {}) {
  const ac = audio();
  if (!ac || !master) return;
  const t = ac.currentTime + (o.delay ?? 0);
  const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 2;
  filter.frequency.setValueAtTime(freq, t);
  if (o.to) filter.frequency.exponentialRampToValueAtTime(o.to, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(o.gain ?? 0.5, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(t);
}

/** UI button press. */
export function boop() {
  tone(560, 0.09, { to: 360, gain: 0.35 });
}

/** New round: a whoop and a pencil scribble. */
export function roundStart() {
  tone(260, 0.28, { type: 'triangle', to: 880, gain: 0.45 });
  for (let i = 0; i < 4; i++) noise(0.07, 2500 + (i % 2) * 1500, { delay: 0.3 + i * 0.08, gain: 0.35, to: 1800 });
}

/** Clock tick (true) or tock (false). */
export function tick(hi: boolean) {
  tone(hi ? 1500 : 1100, 0.04, { type: 'square', gain: 0.12, attack: 0.002 });
}

/** Correct guess: bell DING plus a sparkle. */
export function ding() {
  tone(1318, 1.1, { gain: 0.55, attack: 0.005 });
  tone(1975, 0.8, { gain: 0.25, attack: 0.005 });
  [2093, 2637, 3136, 4186].forEach((f, i) => tone(f, 0.18, { type: 'triangle', delay: 0.12 + i * 0.06, gain: 0.18 }));
}

/** Time's up: sad trombone. */
export function wahWah() {
  [392, 370, 349].forEach((f, i) => tone(f, 0.32, { type: 'triangle', delay: i * 0.34, gain: 0.4 }));
  tone(330, 0.9, { type: 'triangle', delay: 1.02, gain: 0.4, vibrato: 8 });
}

/** Countdown blip; pitch rises as n goes 3 → 1. */
export function blip(n: number) {
  tone([0, 1047, 784, 659][n] ?? 523, 0.1, { type: 'square', gain: 0.18 });
}

/** Results fanfare. */
export function fanfare() {
  [523, 659, 784].forEach((f, i) => tone(f, 0.16, { type: 'square', delay: i * 0.13, gain: 0.2 }));
  tone(1047, 0.7, { type: 'square', delay: 0.4, gain: 0.22, vibrato: 6 });
  tone(523, 0.7, { type: 'triangle', delay: 0.4, gain: 0.3 });
}

/**
 * Wire up gestures, a boop on every button, and the M key. Returns the speaker toggle button.
 * Call once at startup.
 */
export function installSound(): HTMLButtonElement {
  const unlock = () => {
    unlocked = true;
    audio();
  };
  window.addEventListener('pointerdown', unlock, { capture: true });
  window.addEventListener('keydown', unlock, { capture: true });

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sound-toggle';
  const sync = () => {
    btn.textContent = muted ? '🔇' : '🔊';
    btn.title = muted ? 'Sound off (M)' : 'Sound on (M)';
    btn.setAttribute('aria-label', muted ? 'Turn sound on' : 'Turn sound off');
    btn.setAttribute('aria-pressed', String(!muted));
  };
  sync();
  onMuteChange(sync);
  btn.addEventListener('click', () => setMuted(!muted));

  document.addEventListener(
    'click',
    (e) => {
      const b = (e.target as Element | null)?.closest?.('button');
      if (b && b !== btn) boop();
    },
    { capture: true },
  );
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'm' && e.key !== 'M') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.target as Element | null)?.closest?.('input, textarea, select, [contenteditable]')) return;
    setMuted(!muted);
  });
  return btn;
}
