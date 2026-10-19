import { botColor } from './art';
import { REPO } from './header';
import { speedTier } from './speed';
import { el } from './dom';
import type { GameResult } from './game';
import { ROUNDS, tierForRound } from './words';

/**
 * Share cards, drawn on a canvas (no DOM screenshot library) so they look the same everywhere:
 * 1. "Doodles": every round's doodle and who guessed it.
 * 2. "Bot brains": pages of every bot's guess trail per round (more bots or rounds make more pages).
 */

const SIZE = 1080;
const INK = '#2b2b2b';
const MUTED = '#6d6252';
const PAPER = '#fff8e7';
const MINT = '#06d6a0';
const STRIKE = 'rgb(229 56 59 / 0.45)'; // see-through red through wrong guesses
const HAND = '"Short Stack", "Comic Sans MS", cursive';
const BODY = '"Short Stack", "Comic Sans MS", cursive';

export function headlineFor(r: GameResult): string {
  const best = Math.max(0, ...r.scores);
  const winners = r.labels.filter((_, i) => r.scores[i] === best);
  if (r.rounds.length === 0) return 'Game stopped';
  if (best === 0) return r.doodler ? 'Nobody cracked the doodles!' : 'The bots were stumped!';
  // Shared mid-game (Share in the game's controls): it's a lead, not a win yet.
  const midGame = !r.stopped && r.rounds.length < ROUNDS;
  if (winners.length > 1) return midGame ? 'Neck and neck!' : "It's a tie!";
  if (winners[0] === 'You') return midGame ? 'You lead!' : 'You win!';
  return `${shortName(winners[0])} ${midGame ? 'leads' : 'wins'}!`;
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
  const story = r.doodler
    ? `${shortName(r.doodler.label)} doodled, and we raced to guess: ${bots}.`
    : `The bots guessed ${r.playerScore} of my ${r.rounds.length} doodles (${bots}).`;
  return (
    `I just played Doodle Derby ✏️🤖 ${headlineFor(r)} ` +
    story +
    (url ? ` ${url}` : '')
  );
}

type Prepared = { images: (HTMLImageElement | null)[] };

/** Canvas text only uses web fonts that have finished loading; doodles must be decoded first too. */
async function prepare(r: GameResult): Promise<Prepared> {
  await Promise.all([document.fonts.load(`40px ${HAND}`), document.fonts.load(`40px ${BODY}`)]).catch(() => {});
  return { images: await Promise.all(r.rounds.map((round) => (round.image ? loadImage(round.image) : null))) };
}

/** Each column's color: bots coral / sky / grape, You in mint. */
const colorOf = (r: GameResult, i: number) => (i === r.humanIndex ? MINT : botColor(i));

/** Greedily pack item widths into rows that fit max (keeping their order). */
function packRows(widths: number[], max: number, gap: number): number[][] {
  const rows: number[][] = [];
  let row: number[] = [];
  let used = 0;
  widths.forEach((w, i) => {
    if (row.length && used + gap + w > max) {
      rows.push(row);
      row = [];
      used = 0;
    }
    used += (row.length ? gap : 0) + w;
    row.push(i);
  });
  if (row.length) rows.push(row);
  return rows;
}

/** How hard a round was, the same marks as the game's badge (rounds 1–3 easy, 4–7 medium, 8–10 hard). */
const TIER_MARK = {
  easy: { icon: '🌱', bg: '#b8f5dd' },
  medium: { icon: '⭐', bg: '#ffe57e' },
  hard: { icon: '🔥', bg: '#dcc4fa' },
};
const TIME_TINT = {
  fast: { bg: '#c9f2e3', fg: '#05694f' },
  mid: { bg: '#fdf0b8', fg: '#7a5b00' },
  slow: { bg: '#fcd9cc', fg: '#9a3412' },
};

/** Bot indexes, most wins first; ties keep their original order. */
export function chipOrder(scores: number[]): number[] {
  return scores.map((_, i) => i).sort((a, b) => scores[b] - scores[a] || a - b);
}

/** Break at a dash, slash or space into at most two lines that fit max, shrinking the text from size down to min. */
function wrapName(ctx: CanvasRenderingContext2D, text: string, max: number, size: number, min: number): { lines: string[]; px: number } {
  const parts = text.split(/(?<=[-/ ])/);
  for (let px = size; px >= min; px--) {
    ctx.font = `${px}px ${BODY}`;
    if (ctx.measureText(text).width <= max) return { lines: [text], px };
    // The break that leaves the two halves closest in width.
    let best: string[] | null = null;
    let bestDiff = Infinity;
    for (let k = 1; k < parts.length; k++) {
      const pair = [parts.slice(0, k).join('').trimEnd(), parts.slice(k).join('')];
      const [w1, w2] = pair.map((l) => ctx.measureText(l).width);
      if (w1 <= max && w2 <= max && Math.abs(w1 - w2) < bestDiff) {
        best = pair;
        bestDiff = Math.abs(w1 - w2);
      }
    }
    if (best) return { lines: best, px };
  }
  ctx.font = `${min}px ${BODY}`;
  return { lines: [fit(ctx, text, max)], px: min };
}

/** Card 1: the 10 doodles and who guessed each. */
async function buildDoodleCard(r: GameResult, prep?: Prepared): Promise<Blob> {
  const { images } = prep ?? (await prepare(r));
  const { c, ctx } = paper(SIZE, SIZE);
  title(ctx, SIZE, 120, 104);

  ctx.textAlign = 'center';
  ctx.fillStyle = INK;
  ctx.fillText(fitFont(ctx, headlineFor(r), SIZE - 80, 50, 32, BODY), SIZE / 2, 190);

  // Score chips: the bots by wins (ties keep their order), then You. Each shows the whole model name and its
  // score in a small bubble, wrapping onto as many rows as it takes (the text shrinks a little to keep it to 3).
  const chips = [
    ...chipOrder(r.scores).map((i) => ({ name: shortName(r.labels[i], 40), score: String(r.scores[i]), color: colorOf(r, i) })),
    r.doodler
      ? { name: `✏ ${shortName(r.doodler.label, 40)}`, score: `${r.playerScore}/${r.rounds.length}`, color: '#ffd23f' }
      : { name: 'You', score: `${r.playerScore}/${r.rounds.length}`, color: MINT },
  ];
  const maxRow = SIZE - 60;
  const gap = 12;
  const chipH = 46;
  const chipGapY = 10;
  const bubbleOf = (score: string) => Math.max(34, Math.ceil(ctx.measureText(score).width) + 20);
  let size = 26;
  let widths: number[] = [];
  let rows: number[][] = [];
  for (size = 26; size >= 18; size -= 2) {
    ctx.font = `${size}px ${BODY}`;
    widths = chips.map((ch) => Math.min(maxRow, Math.ceil(ctx.measureText(ch.name).width) + bubbleOf(ch.score) + 38));
    rows = packRows(widths, maxRow, gap);
    if (rows.length <= 3) break;
  }
  let y = 218;
  for (const row of rows) {
    const rowW = row.reduce((a, i) => a + widths[i], 0) + gap * (row.length - 1);
    let x = (SIZE - rowW) / 2;
    for (const i of row) {
      const ch = chips[i];
      roundRect(ctx, x, y, widths[i], chipH, chipH / 2);
      ctx.fillStyle = ch.color;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = INK;
      ctx.stroke();
      // The score's bubble, on the right end.
      ctx.font = `${size}px ${BODY}`;
      const bw = bubbleOf(ch.score);
      const bh = chipH - 14;
      roundRect(ctx, x + widths[i] - bw - 7, y + 7, bw, bh, bh / 2);
      ctx.fillStyle = PAPER;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.textAlign = 'center';
      ctx.fillText(ch.score, x + widths[i] - bw / 2 - 7, y + chipH / 2 + size * 0.36);
      ctx.textAlign = 'left';
      ctx.fillText(fitFont(ctx, ch.name, widths[i] - bw - 38, size, 13, BODY), x + 16, y + chipH / 2 + size * 0.36);
      x += widths[i] + gap;
    }
    y += chipH + chipGapY;
  }
  ctx.textAlign = 'center';
  const gridTop = y + 6;

  // Doodle grid: 5 per row. Each tile is captioned with the word, the whole model name, and its time;
  // with many bots the chips take more rows, so the tiles shrink to leave room for the captions.
  const cols = 5;
  const tileGap = 24;
  const shown = r.rounds.slice(0, 10);
  const gridRows = Math.max(1, Math.ceil(shown.length / cols));
  const CAPTION = 160;
  const tile = Math.max(120, Math.min((SIZE - 60 * 2 - tileGap * (cols - 1)) / cols, (SIZE - 62 - gridTop) / gridRows - CAPTION - 8));
  const pitch = Math.min(330, tile + CAPTION + 8);
  shown.forEach((round, i) => {
    // Center each row, so a short game (Stop) doesn't hug the left edge.
    const inRow = Math.min(cols, shown.length - Math.floor(i / cols) * cols);
    const rowStart = (SIZE - inRow * tile - (inRow - 1) * tileGap) / 2;
    const cx = rowStart + (i % cols) * (tile + tileGap);
    const cy = gridTop + Math.floor(i / cols) * pitch;
    drawTile(ctx, cx, cy, tile, images[i], i);

    ctx.textAlign = 'center';
    ctx.fillStyle = INK;
    // The word on one line if it fits at a good size, else split over two ("statue of / liberty").
    const lines = wordLines(ctx, round.word, tile + 16);
    lines.forEach((line, n) => ctx.fillText(line, cx + tile / 2, cy + tile + 40 + n * 30));
    let textY = cy + tile + 40 + (lines.length - 1) * 30;

    if (round.winner === null) {
      ctx.fillStyle = MUTED;
      ctx.font = `23px ${BODY}`;
      ctx.fillText('✗ stumped', cx + tile / 2, textY + 36);
      return;
    }
    // The whole model name (wrapping at its dashes), then the time right under it.
    const { lines: name, px } = wrapName(ctx, `✓ ${shortName(r.labels[round.winner], 40)}`, tile + 20, 20, 14);
    ctx.font = `${px}px ${BODY}`;
    ctx.fillStyle = darker(colorOf(r, round.winner));
    name.forEach((line, n) => ctx.fillText(line, cx + tile / 2, textY + 32 + n * (px + 3)));
    textY += 32 + (name.length - 1) * (px + 3);
    if (round.seconds !== null) {
      const tint = TIME_TINT[speedTier(round.seconds)];
      ctx.font = `21px ${BODY}`;
      const label = `${round.seconds.toFixed(1)}s`;
      const pw = Math.ceil(ctx.measureText(label).width) + 24;
      roundRect(ctx, cx + tile / 2 - pw / 2, textY + 10, pw, 30, 15);
      ctx.fillStyle = tint.bg;
      ctx.fill();
      ctx.fillStyle = tint.fg;
      ctx.fillText(label, cx + tile / 2, textY + 32);
    }
  });

  footer(ctx, SIZE, SIZE);
  return toPng(c);
}

/** The bot brains pages: each is one square page, so a long game or many bots simply take more pages. */
const BRAIN_TOP = 145;
const BRAIN_BOTTOM = 1008;
const BRAIN_LINE = 23;
const BRAIN_MIN_BLOCK = 82; // a round's doodle, word and time have to fit its block

/** How many rounds fit a page (a round's block is one line per bot), and which rounds go on which page, evenly. */
export function brainLayout(rounds: number, bots: number): { blockH: number; pages: number[][] } {
  const blockH = Math.max(BRAIN_MIN_BLOCK, bots * BRAIN_LINE + 9);
  const perPage = Math.max(1, Math.floor((BRAIN_BOTTOM - BRAIN_TOP) / blockH));
  const count = Math.max(1, Math.ceil(rounds / perPage));
  // Spread the rounds over the pages (4, 3, 3 rather than 4, 4, 2): the first pages take the extra ones.
  const base = Math.floor(rounds / count);
  const extra = rounds % count;
  let next = 0;
  const pages = Array.from({ length: count }, (_, p) => {
    const size = base + (p < extra ? 1 : 0);
    return Array.from({ length: size }, () => next++);
  });
  return { blockH, pages };
}

/**
 * Cards 2+, "What were the bots thinking?": a notebook page of rounds, each with its doodle, its word and time,
 * and one line per bot (best first) of that bot's guesses: wrong ones struck through, the right one circled.
 */
async function buildBrainPages(r: GameResult, prep?: Prepared): Promise<Blob[]> {
  const { images } = prep ?? (await prepare(r));
  const rounds = r.rounds.slice(0, 10);
  const order = chipOrder(r.scores);
  const { blockH, pages } = brainLayout(rounds.length, order.length);
  const heading = r.doodler ? 'What was everyone thinking?' : 'What were the bots thinking?';
  const left = 40;
  const nameX = 300;
  const trailX = 520;
  const blobs: Blob[] = [];

  for (const [p, idxs] of pages.entries()) {
    const { c, ctx } = paper(SIZE, SIZE);
    ctx.textAlign = 'center';
    ctx.fillStyle = INK;
    ctx.fillText(fitFont(ctx, heading, SIZE - 80, 66, 40, HAND), SIZE / 2, 92);
    if (pages.length > 1) {
      ctx.textAlign = 'right';
      ctx.fillStyle = MUTED;
      ctx.font = `22px ${BODY}`;
      ctx.fillText(`page ${p + 1} of ${pages.length}`, SIZE - left - 4, 128);
    }

    idxs.forEach((i, k) => {
      const round = rounds[i];
      const y = BRAIN_TOP + k * blockH;
      if (k % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillRect(left - 12, y, SIZE - (left - 12) * 2, blockH);
      }
      dashed(ctx, left - 12, y, SIZE - left + 12);

      // The doodle (numbered), its word, and how fast it was guessed and how hard it was (who guessed it is the
      // mint band). With more bots the block is taller, so the doodle is bigger and the time goes under it.
      const roomy = blockH >= 130;
      const t = roomy ? 86 : 62;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(left, y + 10, t, t);
      const img = images[i];
      if (img) ctx.drawImage(img, left + 2, y + 12, t - 4, t - 4);
      ctx.lineWidth = 3;
      ctx.strokeStyle = INK;
      ctx.strokeRect(left, y + 10, t, t);
      // The round's number, on the doodle's corner.
      ctx.beginPath();
      ctx.arc(left + 4, y + 16, 14, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd23f';
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.textAlign = 'center';
      ctx.font = `${i >= 9 ? 15 : 19}px ${BODY}`;
      ctx.fillText(String(i + 1), left + 4, y + 16 + (i >= 9 ? 5 : 6));
      const textX = left + t + 12;
      ctx.textAlign = 'left';
      ctx.fillStyle = INK;
      const lines = wordLines(ctx, round.word, nameX - textX - 12, 30, 24, 17);
      lines.forEach((line, n) => ctx.fillText(line, textX, y + (lines.length === 1 ? 38 : 28) + n * 22));
      // The time (or "stumped") and the difficulty, side by side: under the doodle when it is big, else under the word.
      let markX = roomy ? left : textX;
      const markY = roomy ? y + 10 + t + 10 : y + (lines.length === 1 ? 48 : 58);
      if (round.winner === null || round.seconds === null) {
        ctx.fillStyle = MUTED;
        ctx.font = `${roomy ? 16 : 15}px ${BODY}`;
        const stumped = roomy ? '✗ stumped' : 'stumped'; // the compact row has less room beside the doodle
        ctx.fillText(stumped, markX, markY + 17);
        markX += Math.ceil(ctx.measureText(stumped).width) + 8;
      } else {
        const tint = TIME_TINT[speedTier(round.seconds)];
        ctx.font = `${roomy ? 18 : 17}px ${BODY}`;
        const label = `${round.seconds.toFixed(1)}s`;
        const padX = roomy ? 11 : 8;
        const pw = Math.ceil(ctx.measureText(label).width) + padX * 2;
        roundRect(ctx, markX, markY, pw, 24, 12);
        ctx.fillStyle = tint.bg;
        ctx.fill();
        ctx.fillStyle = tint.fg;
        ctx.fillText(label, markX + padX, markY + 18);
        markX += pw + (roomy ? 7 : 5);
      }
      const tier = tierForRound(i);
      ctx.font = `${roomy ? 15 : 14}px ${BODY}`;
      const tierLabel = `${TIER_MARK[tier].icon} ${tier}`;
      const tw = Math.ceil(ctx.measureText(tierLabel).width) + (roomy ? 20 : 14);
      roundRect(ctx, markX, markY, tw, 24, 12);
      ctx.fillStyle = TIER_MARK[tier].bg;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.fillText(tierLabel, markX + (roomy ? 10 : 7), markY + 17);

      // One line per bot, best first; the bot that got it right is on a mint band.
      order.forEach((b, j) => {
        const ly = y + 8 + j * BRAIN_LINE;
        const won = round.winner === b;
        if (won) {
          roundRect(ctx, nameX - 8, ly, SIZE - left - nameX + 8, BRAIN_LINE - 1, 7);
          ctx.fillStyle = '#d3f5e8';
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(nameX + 6, ly + BRAIN_LINE / 2, 6, 0, Math.PI * 2);
        ctx.fillStyle = colorOf(r, b);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = INK;
        ctx.stroke();
        ctx.fillStyle = INK;
        ctx.textAlign = 'left';
        ctx.fillText(fitFont(ctx, shortName(r.labels[b], 40), trailX - nameX - 34, 16, 11, BODY), nameX + 20, ly + 17);
        const trail = [
          ...(round.guesses[b] ?? []).map((g) => ({ text: g, right: false })),
          ...(won ? [{ text: round.word, right: true }] : []),
        ];
        drawTrailLine(ctx, trail, trailX, ly + 17, SIZE - left - trailX, darker(colorOf(r, b)));
      });
    });

    footer(ctx, SIZE, SIZE);
    blobs.push(await toPng(c));
  }
  return blobs;
}

/**
 * One bot's guesses on one line, left to right: wrong ones struck through, the right one circled with a ✓.
 * When they don't all fit, the earliest are left off ("…"), so the latest, what it thought last, stays.
 */
function drawTrailLine(ctx: CanvasRenderingContext2D, trail: { text: string; right: boolean }[], x0: number, y: number, width: number, rightColor: string) {
  ctx.textAlign = 'left';
  ctx.font = `18px ${BODY}`;
  if (trail.length === 0) {
    ctx.fillStyle = MUTED;
    ctx.font = `16px ${BODY}`;
    ctx.fillText('round ended', x0, y);
    return;
  }
  const gap = 16;
  const ellipsis = ctx.measureText('… ').width;
  const sized = trail.map((item) => {
    const w = ctx.measureText(item.text).width;
    return { ...item, w, need: item.right ? w + 24 + 24 : w };
  });
  let from = 0;
  const total = (f: number) => sized.slice(f).reduce((a, it) => a + it.need, 0) + gap * (sized.length - f - 1) + (f > 0 ? ellipsis : 0);
  while (from < sized.length - 1 && total(from) > width) from++;
  let x = x0;
  if (from > 0) {
    ctx.fillStyle = MUTED;
    ctx.fillText('…', x, y);
    x += ellipsis;
  }
  for (const item of sized.slice(from)) {
    const text = item.need > width ? fit(ctx, item.text, width - (item.right ? 48 : 0)) : item.text;
    if (item.right) {
      ctx.fillStyle = rightColor;
      ctx.fillText(text, x + 12, y);
      ctx.beginPath(); // a hand-drawn circle around the right answer
      ctx.ellipse(x + 12 + item.w / 2, y - 6, item.w / 2 + 11, 12, -0.06, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = MINT;
      ctx.stroke();
      ctx.fillStyle = '#05a37b';
      ctx.fillText('✓', x + item.w + 30, y);
    } else {
      ctx.fillStyle = INK;
      ctx.fillText(text, x, y);
      ctx.beginPath(); // struck through in see-through red, so the word stays readable
      ctx.moveTo(x - 2, y - 6);
      ctx.lineTo(x + item.w + 2, y - 6);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = STRIKE;
      ctx.stroke();
    }
    x += item.need + gap;
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

/** "Doodle Derby" in two colors, centered on baseline y. */
function title(ctx: CanvasRenderingContext2D, width: number, y: number, size: number) {
  ctx.textAlign = 'left';
  ctx.font = `${size}px ${HAND}`;
  const w1 = ctx.measureText('Doodle ').width;
  const w2 = ctx.measureText('Derby').width;
  const x = (width - w1 - w2) / 2;
  ctx.fillStyle = botColor(0);
  ctx.fillText('Doodle ', x, y);
  ctx.fillStyle = botColor(1);
  ctx.fillText('Derby', x + w1, y);
}

function footer(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.textAlign = 'center';
  ctx.fillStyle = MUTED;
  // The source link, with the game's own link first when it is hosted somewhere (not when running locally).
  const url = gameUrl().replace(/^https?:\/\//, '');
  const source = REPO.replace(/^https?:\/\//, '');
  ctx.fillText(fitFont(ctx, url ? `Play: ${url}  ·  ${source}` : source, width - 80, 30, 20, BODY), width / 2, height - 40);
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

/**
 * A word as one line (from size down to `two` px), or two balanced lines (from `two` down to min) when it
 * has a space; past that it is cut with "…". Sets ctx.font to the size used.
 */
function wordLines(ctx: CanvasRenderingContext2D, word: string, max: number, size = 34, two = 26, min = 20): string[] {
  for (let px = size; px >= two; px--) {
    ctx.font = `${px}px ${HAND}`;
    if (ctx.measureText(word).width <= max) return [word];
  }
  const parts = word.split(' ');
  if (parts.length < 2) return [fitFont(ctx, word, max, two, min, HAND)];
  // Split where the two halves are closest in length.
  let best = 1;
  for (let i = 1; i < parts.length; i++) {
    const diff = (k: number) => Math.abs(parts.slice(0, k).join(' ').length - parts.slice(k).join(' ').length);
    if (diff(i) < diff(best)) best = i;
  }
  const pair = [parts.slice(0, best).join(' '), parts.slice(best).join(' ')];
  for (let px = two; px >= min; px--) {
    ctx.font = `${px}px ${HAND}`;
    if (pair.every((l) => ctx.measureText(l).width <= max)) return pair;
  }
  return pair.map((l) => fit(ctx, l, max));
}

/** Set the largest font size from size down to min that fits text in max; past min, cut it with "…". */
function fitFont(ctx: CanvasRenderingContext2D, text: string, max: number, size: number, min: number, family: string): string {
  for (let px = size; px >= min; px--) {
    ctx.font = `${px}px ${family}`;
    if (ctx.measureText(text).width <= max) return text;
  }
  return fit(ctx, text, max);
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

type Card = { name: string; kind: 'doodles' | 'brains'; file: string; blob: Blob; url: string };

/** Modal with the cards (tabs: doodles, then the brains pages), and share / download / copy actions for the one shown. */
export async function openShareDialog(r: GameResult, onClose?: () => void) {
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
    onClose?.();
  };
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && dismiss();
  close.addEventListener('click', dismiss);
  backdrop.addEventListener('click', (e) => e.target === backdrop && dismiss());
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  close.focus();

  try {
    const prep = await prepare(r);
    const [doodles, brains] = await Promise.all([buildDoodleCard(r, prep), buildBrainPages(r, prep)]);
    const many = brains.length > 1;
    cards = [
      { name: 'Doodles', kind: 'doodles', file: 'doodle-derby.png', blob: doodles, url: URL.createObjectURL(doodles) },
      ...brains.map((blob, i) => ({
        name: many ? `Brains ${i + 1}/${brains.length}` : 'Bot brains',
        kind: 'brains' as const,
        file: many ? `doodle-derby-bot-brains-${i + 1}.png` : 'doodle-derby-bot-brains.png',
        blob,
        url: URL.createObjectURL(blob),
      })),
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
        alt: card.kind === 'doodles' ? 'Share card with all your doodles' : 'Page of every bot’s guesses for each round',
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
    actions.append(button(cards.length > 2 ? 'Share all…' : 'Share both…', 'primary', () => navigator.share({ files, text, title: 'Doodle Derby' })));
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
