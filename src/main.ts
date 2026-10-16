import './style.css';
import { confetti, robot, you } from './art';
import { el } from './dom';
import { Game, type GameResult } from './game';
import type { GuesserConfig } from './providers';
import { costOf, formatTokens, formatUsd, PRICES_FETCHED } from './pricing';
import { renderSetup } from './setup';
import { headlineFor, openShareDialog } from './share';
import { fanfare, installSound } from './sound';
import { tierForRound } from './words';

const app = document.getElementById('app')!;
document.body.append(installSound());
let lastConfigs: GuesserConfig[] = [];

function showSetup() {
  renderSetup(app, startGame);
}

function startGame(configs: GuesserConfig[]) {
  lastConfigs = configs;
  new Game(app, configs, showResults);
}

function showResults(r: GameResult) {
  const best = Math.max(...r.scores);
  const headline = headlineFor(r);

  const again = el('button', { class: 'primary big' }, 'Play again!');
  again.addEventListener('click', () => startGame(lastConfigs));
  const setup = el('button', { class: 'quiet' }, 'Change bots');
  setup.addEventListener('click', showSetup);
  const share = el('button', {}, 'Share your doodles 📸');
  share.addEventListener('click', () => openShareDialog(r));

  // Podium: bots ranked by score (ties share a step), laid out 2nd – 1st – 3rd.
  const ranks = r.scores.map((s) => r.scores.filter((o) => o > s).length);
  const order = r.labels.map((_, i) => i).sort((a, b) => r.scores[b] - r.scores[a] || a - b);
  const layout = order.length >= 2 ? [order[1], order[0], ...order.slice(2)] : order;
  fanfare();
  const podium = el(
    'div',
    { class: 'podium' },
    layout.map((i) => podiumStep(i, r.labels[i], r.scores[i], ranks[i], order.indexOf(i), r.scores[i] === best && best > 0)),
  );
  const youBadge = el('div', { class: 'you-badge card' }, [
    you(),
    el('span', {}, [el('strong', {}, 'You'), ` got ${r.playerScore} of ${r.rounds.length} drawing${r.rounds.length === 1 ? '' : 's'} guessed`]),
  ]);
  if (best > 0) requestAnimationFrame(() => confetti(podium, 60));
  app.replaceChildren(
    el('section', { class: 'results' }, [
      el('h1', {}, headline),
      r.stopped ? el('p', { class: 'note' }, `Stopped after ${r.rounds.length} of 10 rounds.`) : '',
      podium,
      youBadge,
      receipt(r),
      el('div', { class: 'row center' }, [again, ...(r.rounds.length ? [share] : []), setup]),
      el('details', { class: 'report' }, [
        el('summary', {}, 'Round by round'),
        el('table', { class: 'summary report-card' }, [
          el('thead', {}, el('tr', {}, ['#', 'Word', 'Level', 'Guessed by', 'Time'].map((h) => el('th', {}, h)))),
          el(
            'tbody',
            {},
            r.rounds.map((round, i) =>
              el('tr', {}, [
                el('td', {}, String(i + 1)),
                el('td', {}, round.word),
                el('td', {}, el('span', { class: `tier ${tierForRound(i)}` }, tierForRound(i))),
                el('td', {}, round.winner === null ? '—' : r.labels[round.winner]),
                el('td', {}, round.seconds === null ? '—' : `${round.seconds.toFixed(1)}s`),
              ]),
            ),
          ),
        ]),
      ]),
    ]),
  );
}

/** "Bot bill": tokens and cost per bot, folded into one summary line. Hidden when every bot is fake. */
function receipt(r: GameResult) {
  if (r.prices.every((p) => p.kind === 'free' && p.why === 'fake bot')) return '';
  const costs = r.usage.map((u, i) => costOf(u, r.prices[i]));
  const known = costs.filter((c): c is number => c !== null);
  const total = known.reduce((a, b) => a + b, 0);
  const tokens = r.usage.reduce((n, u) => n + u.input + u.output, 0);
  const totalText = known.length ? (known.length < costs.length ? `${formatUsd(total)}+` : formatUsd(total)) : 'price unknown';
  const cell = (text: string, cls = '') => el('td', cls ? { class: cls } : {}, text);
  return el('details', { class: 'receipt' }, [
    el('summary', {}, `🧾 Bot bill: ${totalText} · ${formatTokens(tokens)} tokens`),
    el('table', {}, [
      el('thead', {}, el('tr', {}, ['Bot', 'Calls', 'In', 'Out', 'Cost'].map((h) => el('th', {}, h)))),
      el(
        'tbody',
        {},
        r.labels.map((label, i) =>
          el('tr', {}, [
            cell(label, 'bot-name'),
            cell(String(r.usage[i].calls)),
            cell(formatTokens(r.usage[i].input)),
            cell(formatTokens(r.usage[i].output)),
            cell(r.prices[i].kind === 'free' ? r.prices[i].why === 'fake bot' ? 'free (fake)' : 'free (local)' : formatUsd(costs[i])),
          ]),
        ),
      ),
      el('tfoot', {}, el('tr', {}, [cell('Total'), cell(''), cell(''), cell(''), cell(totalText)])),
    ]),
    el(
      'p',
      { class: 'note' },
      `Prices from models.dev (${PRICES_FETCHED}). Requests cancelled when a round ended aren't counted, so the real bill can be a little higher.`,
    ),
  ]);
}

/**
 * One bot standing on its podium step. The step height comes from its place in the standings
 * (pos 0 = tallest), so steps always differ; the number shows its rank, which ties share.
 */
function podiumStep(i: number, label: string, score: number, rank: number, pos: number, winner: boolean) {
  return el('div', { class: `podium-spot p${i} pos${pos}${winner ? ' winner' : ''}` }, [
    robot(i),
    el('div', { class: 'podium-name' }, label),
    el('div', { class: 'podium-score' }, `${score} ${score === 1 ? 'point' : 'points'}`),
    el('div', { class: 'step' }, el('span', { class: 'place' }, String(rank + 1))),
  ]);
}

showSetup();
