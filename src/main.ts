import './style.css';
import { installDebugPanel } from './debugPanel';
import { confetti, doodlerBot, you } from './art';
import { el } from './dom';
import { Game, type GameResult } from './game';
import { installHeader } from './header';
import type { GuesserConfig } from './providers';
import { renderSetup } from './setup';
import { tallyTable } from './tally';
import { installSettings } from './settings';
import { headlineFor, openShareDialog } from './share';
import { fanfare, installSound } from './sound';
import { tierForRound } from './words';

const app = document.getElementById('app')!;
// The name and links at the top of every screen, then the corner tools (debug, sound, settings).
installHeader();
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

/** A new screen starts at its top, not wherever the last one was scrolled to (Play sits at the bottom). */
const toTop = () => window.scrollTo({ top: 0, behavior: 'instant' });

function showSetup() {
  renderSetup(app, startGame);
  toTop();
}

function startGame(configs: GuesserConfig[], doodler: GuesserConfig | null) {
  lastConfigs = configs;
  lastDoodler = doodler;
  new Game(app, configs, showResults, doodler);
  toTop();
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
  toTop();
}

showSetup();
