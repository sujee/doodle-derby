import { el } from './dom';
import type { GameResult } from './game';

/**
 * Share card: one square image with every round's doodle, who guessed it, and a funny wrong guess.
 * Drawn on a canvas (no DOM screenshot library), so it looks the same everywhere.
 */

const SIZE = 1080;
const INK = '#2b2b2b';
const MUTED = '#6d6252';
const PAPER = '#fff8e7';
const BOT_COLORS = ['#ff6b6b', '#4cc9f0', '#9b5de5'];
const MINT = '#06d6a0';
const HAND = '"Gochi Hand", "Comic Sans MS", cursive';
const BODY = '"Patrick Hand", "Comic Sans MS", cursive';

export function headlineFor(r: GameResult): string {
  const best = Math.max(0, ...r.scores);
  const winners = r.labels.filter((_, i) => r.scores[i] === best);
  if (r.rounds.length === 0) return 'Game stopped';
  if (best === 0) return 'The bots were stumped!';
  return winners.length > 1 ? "It's a tie!" : `${shortName(winners[0])} wins!`;
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
  const url = gameUrl();
  return (
    `I just played Doodle Duel ✏️🤖 ${headlineFor(r)} ` +
    `The bots guessed ${r.playerScore} of my ${r.rounds.length} doodles (${bots}).` +
    (url ? ` ${url}` : '')
  );
}

export async function buildShareCard(r: GameResult): Promise<Blob> {
  // Canvas text only uses web fonts that have finished loading.
  await Promise.all([document.fonts.load(`40px ${HAND}`), document.fonts.load(`40px ${BODY}`)]).catch(() => {});
  const images = await Promise.all(r.rounds.map((round) => (round.image ? loadImage(round.image) : null)));

  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d')!;

  // Paper with a faint dot grid.
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = 'rgba(43,43,43,0.12)';
  for (let x = 18; x < SIZE; x += 36) for (let y = 18; y < SIZE; y += 36) ctx.fillRect(x, y, 3, 3);

  // Title in two colors.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `104px ${HAND}`;
  const w1 = ctx.measureText('Doodle ').width;
  const w2 = ctx.measureText('Duel').width;
  let x = (SIZE - w1 - w2) / 2;
  ctx.fillStyle = BOT_COLORS[0];
  ctx.fillText('Doodle ', x, 120);
  ctx.fillStyle = BOT_COLORS[1];
  ctx.fillText('Duel', x + w1, 120);

  ctx.textAlign = 'center';
  ctx.fillStyle = INK;
  ctx.font = `50px ${BODY}`;
  ctx.fillText(headlineFor(r), SIZE / 2, 190);

  // Score chips: each bot, then You.
  const chips = [
    ...r.labels.map((l, i) => ({ text: `${shortName(l, 18)}: ${r.scores[i]}`, color: BOT_COLORS[i % 3] })),
    { text: `You: ${r.playerScore}/${r.rounds.length}`, color: MINT },
  ];
  ctx.font = `30px ${BODY}`;
  const pad = 22;
  const gap = 16;
  const widths = chips.map((ch) => ctx.measureText(ch.text).width + pad * 2);
  x = (SIZE - widths.reduce((a, b) => a + b, 0) - gap * (chips.length - 1)) / 2;
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
      ctx.fillStyle = darker(BOT_COLORS[round.winner % 3]);
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

  ctx.textAlign = 'center';
  ctx.fillStyle = MUTED;
  ctx.font = `30px ${BODY}`;
  const url = gameUrl();
  ctx.fillText(url ? `Play: ${url.replace(/^https?:\/\//, '')}` : 'You doodle. The bots guess. Fastest bot wins.', SIZE / 2, SIZE - 40);

  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));
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

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Modal with the card preview and share / download / copy actions. */
export async function openShareDialog(r: GameResult) {
  const status = el('p', { class: 'share-status', role: 'status' });
  const preview = el('div', { class: 'share-preview' }, el('p', { class: 'note' }, 'Drawing your card…'));
  const actions = el('div', { class: 'share-actions' });
  const close = el('button', { type: 'button', class: 'icon-btn share-close', 'aria-label': 'Close' }, '✕');
  const dialog = el('div', { class: 'share-dialog card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Share your doodles' }, [
    close,
    el('h2', {}, 'Share your doodles'),
    preview,
    actions,
    status,
  ]);
  const backdrop = el('div', { class: 'share-backdrop' }, dialog);
  let url = '';
  const dismiss = () => {
    backdrop.remove();
    if (url) URL.revokeObjectURL(url);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && dismiss();
  close.addEventListener('click', dismiss);
  backdrop.addEventListener('click', (e) => e.target === backdrop && dismiss());
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  close.focus();

  let blob: Blob;
  try {
    blob = await buildShareCard(r);
  } catch {
    preview.replaceChildren(el('p', { class: 'note' }, 'Could not draw the share card, sorry!'));
    return;
  }
  url = URL.createObjectURL(blob);
  preview.replaceChildren(el('img', { src: url, alt: 'Doodle Duel share card with all your doodles' }));

  const text = shareText(r);
  const file = new File([blob], 'doodle-duel.png', { type: 'image/png' });
  const say = (msg: string) => (status.textContent = msg);
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

  if (navigator.canShare?.({ files: [file] })) {
    actions.append(button('Share…', 'primary', () => navigator.share({ files: [file], text, title: 'Doodle Duel' })));
  }
  actions.append(
    button('Download', navigator.canShare?.({ files: [file] }) ? '' : 'primary', () => {
      const a = el('a', { href: url, download: 'doodle-duel.png' });
      a.click();
      say('Saved doodle-duel.png');
    }),
  );
  if (navigator.clipboard && 'ClipboardItem' in window) {
    actions.append(
      button('Copy image', '', async () => {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
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
