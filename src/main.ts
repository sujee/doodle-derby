import './style.css';
import { installDebugPanel } from './debugPanel';
import { confetti, doodlerBot, you } from './art';
import { el } from './dom';
import { Game, type GameResult } from './game';
import type { GuesserConfig } from './providers';
import { costOf, formatTokens, formatUsd } from './pricing';
import { renderSetup } from './setup';
import { installSettings } from './settings';
import { headlineFor, openShareDialog } from './share';
import { fanfare, installSound } from './sound';
import { tierForRound } from './words';

const app = document.getElementById('app')!;
// Corner tools on every screen: the debug log, the sound toggle and the settings menu.
const debugLog = installDebugPanel();
const settings = installSettings();
document.body.append(
  el('div', { class: 'corner-tools' }, [debugLog.button, installSound(), settings.button]),
  settings.panel,
  debugLog.panel,
);
let lastConfigs: GuesserConfig[] = [];
let lastDoodler: GuesserConfig | null = null;

function showSetup() {
  renderSetup(app, startGame);
}

function startGame(configs: GuesserConfig[], doodler: GuesserConfig | null) {
  lastConfigs = configs;
  lastDoodler = doodler;
  new Game(app, configs, showResults, doodler);
}

function showResults(r: GameResult) {
  const headline = headlineFor(r);

  const again = el('button', { class: 'primary big' }, 'Play again!');
  again.addEventListener('click', () => startGame(lastConfigs, lastDoodler));
  const setup = el('button', { class: 'quiet' }, 'Change bots');
  setup.addEventListener('click', showSetup);
  const share = el('button', {}, 'Share your doodles 📸');
  share.addEventListener('click', () => openShareDialog(r));

  const drawings = `${r.playerScore} of ${r.rounds.length} drawing${r.rounds.length === 1 ? '' : 's'} guessed`;
  const youBadge = r.doodler
    ? el('div', { class: 'you-badge doodler-badge card' }, [doodlerBot(), el('span', {}, [el('strong', {}, `✏️ ${r.doodler.label}`), ` got ${drawings}`])])
    : el('div', { class: 'you-badge card' }, [you(), el('span', {}, [el('strong', {}, 'You'), ` got ${drawings}`])]);

  const tally = tallyTable(r);
  fanfare();
  requestAnimationFrame(() => confetti(tally, 60));
  app.replaceChildren(
    el('section', { class: 'results' }, [
      el('h1', {}, headline),
      r.stopped ? el('p', { class: 'note' }, `Stopped after ${r.rounds.length} of 10 rounds.`) : '',
      tally,
      el('div', { class: 'row center' }, [again, ...(r.rounds.length ? [share] : []), setup]),
      youBadge,
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

/**
 * The final tally: one row per guesser, best standing first, with their right guesses, all guesses
 * they made, API calls, tokens and cost. Scrolls sideways on a phone.
 */
function tallyTable(r: GameResult) {
  // Standing: ties share a place (1, 1, 3 …).
  const ranks = r.scores.map((s) => r.scores.filter((o) => o > s).length + 1);
  const order = r.labels.map((_, i) => i).sort((a, b) => r.scores[b] - r.scores[a] || a - b);
  // Guesses made: the distinct wrong ones each round, plus the round they got right.
  const guesses = r.labels.map((_, i) =>
    r.rounds.reduce((n, round) => n + round.guesses[i].length + (round.winner === i ? 1 : 0), 0),
  );
  const costs = r.usage.map((u, i) => costOf(u, r.prices[i]));
  const money = (i: number) =>
    r.prices[i].kind === 'free' ? 'free' : costs[i] === null ? 'price ?' : formatUsd(costs[i]);
  const total = costs.reduce<number>((a, c) => a + (c ?? 0), 0);
  const priced = r.prices.some((p) => p.kind === 'priced');
  const head = ['Standing', 'Model', 'Correct', 'Guesses', 'API calls', 'Tokens in', 'Tokens out', 'Cost'];
  return el('div', { class: 'tally-wrap' }, [
    el('table', { class: 'tally' }, [
      el('caption', {}, `Winning tally${priced ? ` · ${formatUsd(total)}` : ''}`),
      el('thead', {}, el('tr', {}, head.map((h) => el('th', {}, h)))),
      el(
        'tbody',
        {},
        order.map((i) =>
          el('tr', { class: i === r.humanIndex ? 'human' : '' }, [
            el('td', { class: 'rank' }, String(ranks[i])),
            el('td', { class: 'model' }, r.labels[i]),
            el('td', {}, String(r.scores[i])),
            el('td', {}, String(guesses[i])),
            el('td', {}, String(r.usage[i].calls)),
            el('td', {}, formatTokens(r.usage[i].input)),
            el('td', {}, formatTokens(r.usage[i].output)),
            el('td', {}, money(i)),
          ]),
        ),
      ),
    ]),
  ]);
}

showSetup();
