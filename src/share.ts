import { el } from './dom';
import type { GameResult } from './game';

/**
 * Share cards, drawn on a canvas (no DOM screenshot library) so they look the same everywhere:
 * 1. "Doodles": every round's doodle, who guessed it, and a funny wrong guess.
 * 2. "Bot brains": a table of every bot's guess trail per round, plus the wildest guess of the game.
 */

const SIZE = 1080;
const INK = '#2b2b2b';
const MUTED = '#6d6252';
const PAPER = '#fff8e7';
const BOT_COLORS = ['#ff6b6b', '#4cc9f0', '#9b5de5'];
const MINT = '#06d6a0';
const STRIKE = 'rgb(229 56 59 / 0.45)'; // see-through red through wrong guesses
const HAND = '"Short Stack", "Comic Sans MS", cursive';
const BODY = '"Short Stack", "Comic Sans MS", cursive';

export function headlineFor(r: GameResult): string {
  const best = Math.max(0, ...r.scores);
  const winners = r.labels.filter((_, i) => r.scores[i] === best);
  if (r.rounds.length === 0) return 'Game stopped';
  if (best === 0) return r.doodler ? 'Nobody cracked the doodles!' : 'The bots were stumped!';
  if (winners.length > 1) return "It's a tie!";
  return winners[0] === 'You' ? 'You win!' : `${shortName(winners[0])} wins!`;
}

/** "meta-llama/Llama-4-Maverick-17B" → "Llama-4-Maverick-17B", trimmed to fit a chip. */
export function shortName(label: string, max = 22): string {
  const name = label.split('/').pop() ?? label;
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

/** Public link to the game, or '' when running locally. */
function gameUrl(): string {
  const { protocol, hostname, origin, pathname } = location;
  if (!protocol.startsWith('http') || /^(localhost|127\.|\[::1\])/.test(hostname)) return '';
  return origin + pathname;
}

export function shareText(r: GameResult): string {
  const bots = r.labels.map((l, i) => `${shortName(l)} ${r.scores[i]}`).join(' · ');
  const wild = wildestGuess(r);
  const url = gameUrl();
  const story = r.doodler
    ? `${shortName(r.doodler.label)} doodled, and we raced to guess: ${bots}.`
    : `The bots guessed ${r.playerScore} of my ${r.rounds.length} doodles (${bots}).`;
  return (
    `I just played Doodle Duel ✏️🤖 ${headlineFor(r)} ` +
    story +
    (wild ? ` Wildest guess: “${wild.guess}” for ${wild.word}.` : '') +
    (url ? ` ${url}` : '')
  );
}

/** The wildest wrong guess of the game: the wordiest one (long guesses tend to be the funny ones). */
export function wildestGuess(r: GameResult): { guess: string; word: string; bot: number } | null {
  let best: { guess: string; word: string; bot: number } | null = null;
  for (const round of r.rounds) {
    round.guesses.forEach((list, bot) => {
      for (const guess of list) if (!best || guess.length > best.guess.length) best = { guess, word: round.word, bot };
    });
  }
  return best;
}

type Prepared = { images: (HTMLImageElement | null)[] };

/** Canvas text only uses web fonts that have finished loading; doodles must be decoded first too. */
async function prepare(r: GameResult): Promise<Prepared> {
  await Promise.all([document.fonts.load(`40px ${HAND}`), document.fonts.load(`40px ${BODY}`)]).catch(() => {});
  return { images: await Promise.all(r.rounds.map((round) => (round.image ? loadImage(round.image) : null))) };
}

/** Each column's color: bots coral / sky / grape, You in mint. */
const colorOf = (r: GameResult, i: number) => (i === r.humanIndex ? MINT : BOT_COLORS[i % 3]);

/** Card 1: the 10 doodles, who guessed each, and one funny wrong guess. */
export async function buildDoodleCard(r: GameResult, prep?: Prepared): Promise<Blob> {
  const { images } = prep ?? (await prepare(r));
  const { c, ctx } = paper(SIZE, SIZE);
  title(ctx, SIZE, 120, 104);

  ctx.textAlign = 'center';
  ctx.fillStyle = INK;
  ctx.font = `50px ${BODY}`;
  ctx.fillText(headlineFor(r), SIZE / 2, 190);

  // Score chips: each bot, then You.
  const chips = [
    ...r.labels.map((l, i) => ({ text: `${shortName(l, 18)}: ${r.scores[i]}`, color: colorOf(r, i) })),
    r.doodler
      ? { text: `✏ ${shortName(r.doodler.label, 14)}: ${r.playerScore}/${r.rounds.length}`, color: '#ffd23f' }
      : { text: `You: ${r.playerScore}/${r.rounds.length}`, color: MINT },
  ];
  ctx.font = `30px ${BODY}`;
  const pad = 22;
  const gap = 16;
  const widths = chips.map((ch) => ctx.measureText(ch.text).width + pad * 2);
  let x = (SIZE - widths.reduce((a, b) => a + b, 0) - gap * (chips.length - 1)) / 2;
  chips.forEach((ch, i) => {
    roundRect(ctx, x, 222, widths[i], 50, 25);
    ctx.fillStyle = ch.color;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.fillText(ch.text, x + widths[i] / 2, 258);
    x += widths[i] + gap;
  });

  // Doodle grid: 5 × 2.
  const cols = 5;
  const tileGap = 24;
  const tile = (SIZE - 60 * 2 - tileGap * (cols - 1)) / cols;
  const shown = r.rounds.slice(0, 10);
  shown.forEach((round, i) => {
    // Center each row, so a short game (Stop) doesn't hug the left edge.
    const inRow = Math.min(cols, shown.length - Math.floor(i / cols) * cols);
    const rowStart = (SIZE - inRow * tile - (inRow - 1) * tileGap) / 2;
    const cx = rowStart + (i % cols) * (tile + tileGap);
    const cy = 320 + Math.floor(i / cols) * 330;
    drawTile(ctx, cx, cy, tile, images[i], i);

    ctx.textAlign = 'center';
    ctx.fillStyle = INK;
    ctx.font = `36px ${HAND}`;
    ctx.fillText(fit(ctx, round.word, tile), cx + tile / 2, cy + tile + 46);

    ctx.font = `25px ${BODY}`;
    if (round.winner !== null) {
      ctx.fillStyle = darker(colorOf(r, round.winner));
      const t = round.seconds !== null ? ` ${round.seconds.toFixed(1)}s` : '';
      ctx.fillText(fit(ctx, `✓ ${shortName(r.labels[round.winner], 12)}${t}`, tile + 10), cx + tile / 2, cy + tile + 78);
    } else {
      ctx.fillStyle = MUTED;
      ctx.fillText('✗ stumped', cx + tile / 2, cy + tile + 78);
    }
    const funny = round.guesses.flat()[0];
    if (funny) {
      ctx.fillStyle = MUTED;
      ctx.font = `22px ${BODY}`;
      ctx.fillText(fit(ctx, `“${funny}?”`, tile + 10), cx + tile / 2, cy + tile + 106);
    }
  });

  footer(ctx, SIZE, SIZE, r);
  return toPng(c);
}

/**
 * Card 2, "What were the bots thinking?": a notebook table with one row per round (doodle + word)
 * and one column per bot. Each cell is that bot's guess trail: wrong guesses struck through in
 * see-through red, the right one in the bot's color and circled.
 */
export async function buildBrainCard(r: GameResult, prep?: Prepared): Promise<Blob> {
  const { images } = prep ?? (await prepare(r));
  const rows = r.rounds.slice(0, 10);
  const top = 290;
  const rowH = 104;
  const height = Math.max(SIZE, top + rows.length * rowH + 100);
  const { c, ctx } = paper(SIZE, height);

  ctx.textAlign = 'center';
  ctx.fillStyle = INK;
  ctx.font = `66px ${HAND}`;
  ctx.fillText(r.doodler ? 'What was everyone thinking?' : 'What were the bots thinking?', SIZE / 2, 92);

  // "Wildest guess" banner, slightly tilted like a sticker.
  const wild = wildestGuess(r);
  ctx.font = `32px ${BODY}`;
  const banner = wild
    ? `Wildest guess: “${wild.guess}” for ${wild.word} (${shortName(r.labels[wild.bot], 16)})`
    : 'No wrong guesses at all. Show-offs!';
  const bw = Math.min(SIZE - 80, ctx.measureText(banner).width + 60);
  ctx.save();
  ctx.translate(SIZE / 2, 152);
  ctx.rotate((-1.2 * Math.PI) / 180);
  roundRect(ctx, -bw / 2, -32, bw, 64, 32);
  ctx.fillStyle = '#ffd23f';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.fillText(fit(ctx, banner, bw - 40), 0, 11);
  ctx.restore();

  // Column headers: bot names in their colors.
  const left = 40;
  const colStart = 300;
  const colW = (SIZE - colStart - left) / Math.max(1, r.labels.length);
  ctx.textAlign = 'left';
  ctx.font = `30px ${HAND}`;
  ctx.fillStyle = MUTED;
  ctx.fillText('Round', left, top - 26);
  r.labels.forEach((label, b) => {
    ctx.fillStyle = darker(colorOf(r, b));
    ctx.fillText(fit(ctx, shortName(label), colW - 16), colStart + b * colW, top - 26);
  });

  rows.forEach((round, i) => {
    const y = top + i * rowH;
    if (i % 2 === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(left - 12, y, SIZE - (left - 12) * 2, rowH);
    }
    dashed(ctx, left - 12, y, SIZE - left + 12);

    // Thumbnail + word + time.
    const t = 80;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(left, y + 12, t, t);
    const img = images[i];
    if (img) ctx.drawImage(img, left + 2, y + 14, t - 4, t - 4);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = INK;
    ctx.strokeRect(left, y + 12, t, t);
    ctx.textAlign = 'left';
    ctx.fillStyle = INK;
    ctx.font = `34px ${HAND}`;
    ctx.fillText(fit(ctx, round.word, colStart - left - t - 30), left + t + 16, y + 52);
    ctx.fillStyle = MUTED;
    ctx.font = `20px ${BODY}`;
    ctx.fillText(
      round.winner === null ? 'stumped' : `got in ${round.seconds?.toFixed(1) ?? '?'}s`,
      left + t + 16,
      y + 80,
    );

    // Each bot's guess trail.
    r.labels.forEach((_, b) => {
      const trail = [
        ...(round.guesses[b] ?? []).map((g) => ({ text: g, right: false })),
        ...(round.winner === b ? [{ text: round.word, right: true }] : []),
      ];
      drawTrail(ctx, trail, colStart + b * colW, y + 36, colW - 22, colorOf(r, b));
    });
  });
  dashed(ctx, left - 12, top + rows.length * rowH, SIZE - left + 12);

  footer(ctx, SIZE, height, r);
  return toPng(c);
}

/** Lay out guesses left to right, wrapping, up to 3 lines: wrong ones struck through, the right one circled. */
function drawTrail(
  ctx: CanvasRenderingContext2D,
  trail: { text: string; right: boolean }[],
  x0: number,
  y0: number,
  width: number,
  color: string,
) {
  ctx.textAlign = 'left';
  if (trail.length === 0) {
    ctx.fillStyle = MUTED;
    ctx.font = `24px ${BODY}`;
    ctx.fillText('(quiet)', x0, y0 + 10);
    return;
  }
  const lineH = 29;
  let x = x0;
  let line = 0;
  for (const item of trail) {
    ctx.font = item.right ? `30px ${HAND}` : `24px ${BODY}`;
    const text = fit(ctx, item.text, width - 40);
    const w = ctx.measureText(text).width;
    const need = item.right ? w + 40 : w;
    if (x > x0 && x + need > x0 + width) {
      line++;
      x = x0;
    }
    if (line > 2) {
      ctx.fillStyle = MUTED;
      ctx.font = `24px ${BODY}`;
      ctx.fillText('…', x0 + width - 10, y0 + 2 * lineH);
      return;
    }
    const y = y0 + line * lineH;
    if (item.right) {
      ctx.fillStyle = darker(color);
      ctx.fillText(text, x + 6, y);
      ctx.beginPath(); // hand-drawn circle around the right answer
      ctx.ellipse(x + 6 + w / 2, y - 9, w / 2 + 10, 18, -0.06, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = MINT;
      ctx.stroke();
      ctx.fillStyle = '#05a37b';
      ctx.font = `26px ${BODY}`;
      ctx.fillText('✓', x + w + 20, y);
      x += need + 8;
    } else {
      // Wrong guess: struck through in see-through red, so the word stays readable.
      ctx.fillStyle = INK;
      ctx.fillText(text, x, y);
      ctx.beginPath();
      ctx.moveTo(x - 2, y - 7);
      ctx.lineTo(x + w + 2, y - 7);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = STRIKE;
      ctx.stroke();
      x += w + 14;
    }
  }
}

/** A cream sheet with a faint dot grid. */
function paper(width: number, height: number) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(43,43,43,0.12)';
  for (let x = 18; x < width; x += 36) for (let y = 18; y < height; y += 36) ctx.fillRect(x, y, 3, 3);
  ctx.textBaseline = 'alphabetic';
  return { c, ctx };
}

/** "Doodle Duel" in two colors, centered on baseline y. */
function title(ctx: CanvasRenderingContext2D, width: number, y: number, size: number) {
  ctx.textAlign = 'left';
  ctx.font = `${size}px ${HAND}`;
  const w1 = ctx.measureText('Doodle ').width;
  const w2 = ctx.measureText('Duel').width;
  const x = (width - w1 - w2) / 2;
  ctx.fillStyle = BOT_COLORS[0];
  ctx.fillText('Doodle ', x, y);
  ctx.fillStyle = BOT_COLORS[1];
  ctx.fillText('Duel', x + w1, y);
}

function footer(ctx: CanvasRenderingContext2D, width: number, height: number, r: GameResult) {
  ctx.textAlign = 'center';
  ctx.fillStyle = MUTED;
  ctx.font = `30px ${BODY}`;
  const url = gameUrl();
  ctx.fillText(url ? `Play: ${url.replace(/^https?:\/\//, '')}` : r.doodler ? 'A bot doodles. Everyone races to guess it.' : 'You doodle. The bots guess. Fastest bot wins.', width / 2, height - 40);
}

function drawTile(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, img: HTMLImageElement | null, i: number) {
  ctx.save();
  ctx.translate(x + size / 2, y + size / 2);
  ctx.rotate(((i % 2 ? 1 : -1) * (1 + (i % 3) * 0.5) * Math.PI) / 180);
  ctx.translate(-size / 2, -size / 2);
  ctx.fillStyle = INK; // hard offset shadow
  ctx.fillRect(6, 6, size, size);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  if (img) {
    ctx.drawImage(img, 4, 4, size - 8, size - 8);
  } else {
    ctx.fillStyle = MUTED;
    ctx.font = `26px ${BODY}`;
    ctx.textAlign = 'center';
    ctx.fillText('(blank)', size / 2, size / 2 + 8);
  }
  ctx.lineWidth = 4;
  ctx.strokeStyle = INK;
  ctx.strokeRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(255, 210, 63, 0.75)'; // tape
  ctx.fillRect(size / 2 - 34, -12, 68, 24);
  ctx.restore();
}

function dashed(ctx: CanvasRenderingContext2D, x1: number, y: number, x2: number) {
  ctx.save();
  ctx.setLineDash([8, 7]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(43,43,43,0.35)';
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  ctx.restore();
}

function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Bot colors are too light for text on cream; darken them a bit. */
function darker(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.round(v * 0.62);
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}

function toPng(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

type Card = { name: string; file: string; blob: Blob; url: string };

/** Modal with both cards (tabs), and share / download / copy actions for the one shown. */
export async function openShareDialog(r: GameResult) {
  const status = el('p', { class: 'share-status', role: 'status' });
  const tabs = el('div', { class: 'share-tabs', role: 'tablist' });
  const preview = el('div', { class: 'share-preview' }, el('p', { class: 'note' }, 'Drawing your cards…'));
  const actions = el('div', { class: 'share-actions' });
  const close = el('button', { type: 'button', class: 'icon-btn share-close', 'aria-label': 'Close' }, '✕');
  const dialog = el('div', { class: 'share-dialog card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Share your doodles' }, [
    close,
    el('h2', {}, 'Share your doodles'),
    tabs,
    preview,
    actions,
    status,
  ]);
  const backdrop = el('div', { class: 'share-backdrop' }, dialog);
  let cards: Card[] = [];
  const dismiss = () => {
    backdrop.remove();
    cards.forEach((c) => URL.revokeObjectURL(c.url));
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && dismiss();
  close.addEventListener('click', dismiss);
  backdrop.addEventListener('click', (e) => e.target === backdrop && dismiss());
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  close.focus();

  try {
    const prep = await prepare(r);
    const [doodles, brains] = await Promise.all([buildDoodleCard(r, prep), buildBrainCard(r, prep)]);
    cards = [
      { name: 'Doodles', file: 'doodle-duel.png', blob: doodles, url: URL.createObjectURL(doodles) },
      { name: 'Bot brains', file: 'doodle-duel-bot-brains.png', blob: brains, url: URL.createObjectURL(brains) },
    ];
  } catch {
    preview.replaceChildren(el('p', { class: 'note' }, 'Could not draw the share cards, sorry!'));
    return;
  }

  const text = shareText(r);
  const files = cards.map((c) => new File([c.blob], c.file, { type: 'image/png' }));
  const canShareFiles = !!navigator.canShare?.({ files });
  const say = (msg: string) => (status.textContent = msg);
  let current = cards[0];

  const show = (card: Card) => {
    current = card;
    preview.replaceChildren(
      el('img', {
        src: card.url,
        alt: card.name === 'Doodles' ? 'Share card with all your doodles' : 'Table of every bot’s guesses for each round',
      }),
    );
    for (const b of tabs.children) b.setAttribute('aria-selected', String(b.textContent === card.name));
    say('');
  };
  tabs.append(
    ...cards.map((card) => {
      const b = el('button', { type: 'button', role: 'tab', class: 'share-tab' }, card.name);
      b.addEventListener('click', () => show(card));
      return b;
    }),
  );
  show(cards[0]);

  const button = (label: string, cls: string, fn: () => Promise<void> | void) => {
    const b = el('button', { type: 'button', class: cls }, label);
    b.addEventListener('click', async () => {
      try {
        await fn();
      } catch (e) {
        if ((e as Error)?.name !== 'AbortError') say('That didn’t work here. Try Download instead.');
      }
    });
    return b;
  };

  if (canShareFiles) {
    actions.append(button('Share both…', 'primary', () => navigator.share({ files, text, title: 'Doodle Duel' })));
  }
  actions.append(
    button('Download', canShareFiles ? '' : 'primary', () => {
      el('a', { href: current.url, download: current.file }).click();
      say(`Saved ${current.file}`);
    }),
  );
  if (navigator.clipboard && 'ClipboardItem' in window) {
    actions.append(
      button('Copy image', '', async () => {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': current.blob })]);
        say('Image copied! Paste it into a post.');
      }),
    );
  }
  if (navigator.clipboard) {
    actions.append(
      button('Copy text', 'quiet', async () => {
        await navigator.clipboard.writeText(text);
        say('Text copied!');
      }),
    );
  }
}
