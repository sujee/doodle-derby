import { catalogVision } from './pricing';
import {
  createGuesser,
  GuessError,
  listModels,
  OPENAI_PRESETS,
  sortModels,
  type GuesserConfig,
  type ModelInfo,
  type ProviderKind,
} from './providers';
import { doodlerBot, robot, you } from './art';
import { createDoodler } from './doodler';
import { el } from './dom';

const CUSTOM = '__custom__';

type Slot = {
  root: HTMLElement;
  removeBtn: HTMLElement;
  read(): GuesserConfig;
  kind(): ProviderKind;
  /** Models currently offered in this slot's dropdown. */
  models(): ModelInfo[];
  model(): string;
  /** Called when the provider, model list, or chosen model changes. */
  onChange(fn: () => void): void;
};

const MAX_BOTS = 3;

/** Render the setup screen. Calls onStart with 1–3 guesser configs, plus the doodler bot's config when a bot draws. */
export function renderSetup(container: HTMLElement, onStart: (configs: GuesserConfig[], doodler: GuesserConfig | null) => void) {
  container.replaceChildren();
  const first = makeSlot(1);
  const slots = [first, ...Array.from({ length: MAX_BOTS - 1 }, (_, i) => makeSlot(i + 2, first))];
  const doodlerSlot = makeSlot(0, first, true);

  // Pick the doodler: click the You card or the Bot card. The picked card is highlighted; a picked
  // Bot expands into its model settings, and You become one of the guessers.
  let botDraws = false;
  const youRole = el('p', { class: 'you-role' });
  const youCard = pickCard(el('div', { class: 'you-card card' }, [you(), el('h2', {}, 'You'), youRole]), () => setMode(false));
  const botCard = pickCard(
    el('div', { class: 'bot-pick card' }, [doodlerBot(), el('h2', {}, 'Bot'), el('p', {}, 'let a bot doodle')]),
    () => setMode(true),
  );
  const lede = el('p', { class: 'lede' });
  const slotsEl = el('div', { class: 'slots' });
  const doodlerSide = el('div', { class: 'doodler-side', role: 'group', 'aria-label': 'Pick the doodler' }, [
    el('p', { class: 'pick-label' }, [el('span', { class: 'step-num' }, '1'), 'Pick the doodler']),
    youCard,
    botCard,
  ]);
  const vs = el('div', { class: 'vs', 'aria-label': 'versus' }, 'VS');
  const guesserRow = el('div', { class: 'guesser-row' });
  const guessersSide = el('div', { class: 'guessers-side', role: 'group', 'aria-label': 'Pick the guessers' }, [
    el('p', { class: 'pick-label' }, [el('span', { class: 'step-num' }, '2'), 'Pick the guessers']),
    guesserRow,
  ]);
  let count = 1;
  const addLabel = el('span');
  const add = el('button', { type: 'button', class: 'add-bot' }, [
    el('span', { class: 'plus', 'aria-hidden': 'true' }, '+'),
    addLabel,
  ]);
  const note = el('p', { class: 'note' }, 'Your API keys stay in this tab. They’re never saved and only go to the endpoint you pick.');
  const syncNote = () =>
    (note.hidden = ![...slots.slice(0, count), ...(botDraws ? [doodlerSlot] : [])].some((s) => s.kind() !== 'fake'));
  const setMode = (bot: boolean) => {
    botDraws = bot;
    lede.textContent = bot ? 'A bot doodles. You and the bots race to guess it.' : 'You doodle. The bots guess. Fastest bot wins.';
    youRole.textContent = bot ? 'guessing 🔍' : 'the doodler ✏️';
    setPicked(youCard, !bot);
    setPicked(botCard, false);
    doodlerSlot.root.classList.toggle('picked', bot);
    // A picked Bot shows its settings in place of the compact card.
    doodlerSide.replaceChildren(doodlerSide.firstChild!, youCard, bot ? doodlerSlot.root : botCard);
    guesserRow.replaceChildren(...slots.map((s) => s.root), add);
    slotsEl.replaceChildren(doodlerSide, vs, guessersSide);
    syncNote();
  };
  doodlerSlot.onChange(syncNote);
  const setCount = (n: number) => {
    count = n;
    slots.forEach((s, i) => {
      s.root.hidden = i >= n;
      s.removeBtn.hidden = i === 0 || i !== n - 1;
    });
    add.hidden = n >= MAX_BOTS;
    addLabel.textContent = `Doodlebot #${n + 1}`;
    add.setAttribute('aria-label', `Add Doodlebot #${n + 1}`);
    error.textContent = '';
    syncNote();
  };
  add.addEventListener('click', () => {
    setCount(count + 1);
    slots[count - 1].root.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  for (const s of slots) {
    s.removeBtn.addEventListener('click', () => setCount(count - 1));
    s.onChange(syncNote);
  }
  const error = el('p', { class: 'error', role: 'alert' });
  setCount(1);
  setMode(false);
  const start = el('button', { class: 'primary big start' }, 'Play!');
  start.addEventListener('click', () => {
    const configs: GuesserConfig[] = [];
    for (const s of slots.slice(0, count)) {
      const c = s.read();
      if (c.kind !== 'fake' && !c.model) return void (error.textContent = 'Pick a model for each Doodlebot first.');
      if (c.kind === 'openai' && !c.baseUrl) return void (error.textContent = 'Enter the API URL.');
      configs.push(c);
    }
    let doodler: GuesserConfig | null = null;
    if (botDraws) {
      doodler = doodlerSlot.read();
      if (doodler.kind !== 'fake' && !doodler.model) return void (error.textContent = 'Pick a model for the doodler bot.');
      if (doodler.kind === 'openai' && !doodler.baseUrl) return void (error.textContent = 'Enter the doodler’s API URL.');
    }
    onStart(configs, doodler);
  });

  container.append(
    el('section', { class: 'setup' }, [
      el('h1', { class: 'logo' }, [robot(0), el('span', {}, [el('span', { class: 'w1' }, 'Doodle'), ' ', el('span', { class: 'w2' }, 'Duel')]), robot(1)]),
      lede,
      slotsEl,
      note,
      // Pinned to the bottom of the screen, so Play stays in view however tall the bot cards get.
      el('div', { class: 'start-bar' }, [error, start]),
    ]),
  );
}

/**
 * With a leader, the slot offers "Same provider as Guesser 1" and then only asks for a model.
 * The doodler slot (doodler = true) draws instead of guessing: no vision filter, and Test asks for a drawing.
 */
function makeSlot(n: number, leader?: Slot, doodler = false): Slot {
  // One flat provider list: OpenAI-compatible presets are "openai:<index>".
  // Fake guesser first (the no-key default), real providers A–Z, generic "OpenAI compatible" last.
  const presets = OPENAI_PRESETS.map((p, i) => [`openai:${i}`, p.name]);
  const generic = presets.filter(([, name]) => name === 'OpenAI compatible');
  const named = [['anthropic', 'Anthropic'], ...presets.filter((p) => !generic.includes(p))];
  named.sort((a, b) => a[1].localeCompare(b[1]));
  const kind = select([['fake', doodler ? 'Fake doodler (no key)' : 'Fake guesser (no key)'], ...named, ...generic], 'fake');
  const baseUrl = el('input', { type: 'url', placeholder: 'https://…/v1' }) as HTMLInputElement;
  const apiKey = el('input', { type: 'password', autocomplete: 'off', placeholder: 'API key' }) as HTMLInputElement;
  const modelSelect = el('select') as HTMLSelectElement;
  const customModel = el('input', { placeholder: 'Type a model name' }) as HTMLInputElement;
  const visionOnly = el('input', { type: 'checkbox' }) as HTMLInputElement;
  visionOnly.checked = !doodler; // drawing doesn't need image input
  const loadBtn = el('button', { type: 'button' }, 'Load models');
  const testBtn = el('button', { type: 'button' }, 'Test');
  const status = el('p', { class: 'status' });
  const help = el('p', { class: 'note' });

  const urlRow = field('API URL', baseUrl);
  const keyRow = field('API key', apiKey);
  const providerRow = field('Provider', kind);
  const sameBox = el('input', { type: 'checkbox' }) as HTMLInputElement;
  sameBox.checked = !!leader;
  const sameRow = el('label', { class: 'check' }, [sameBox, 'Same provider as Doodlebot #1']);
  sameRow.hidden = !leader;
  const isSame = () => !!leader && sameBox.checked;
  let ids: ModelInfo[] = [];
  const listeners: (() => void)[] = [];
  const notify = () => listeners.forEach((fn) => fn());

  const modelRow = field(
    'Model',
    el('div', { class: 'stack' }, [
      el('div', { class: 'row' }, [modelSelect, loadBtn]),
      customModel,
    ]),
  );
  const visionRow = el('label', { class: 'check small' }, [visionOnly, 'Only show models that can see images']);

  const slotKind = (): ProviderKind => kind.value.split(':')[0] as ProviderKind;

  // A real <select> (datalist suggestions filter by the typed text and are flaky in Safari).
  // Grouped so image-capable models come first; text-only ones are still pickable but flagged.
  const setModels = (all: ModelInfo[], prefer = modelValue()) => {
    ids = all;
    const list = visionOnly.checked ? all.filter((m) => m.vision === 'yes' || m.vision === 'likely') : all;
    const option = (m: ModelInfo) => el('option', { value: m.id }, m.vision === 'likely' ? `${m.id} (likely)` : m.id);
    const groups: [string, ModelInfo[]][] = [
      ['Accepts images', list.filter((m) => m.vision === 'yes' || m.vision === 'likely')],
      ['Unknown (use Test to check)', list.filter((m) => m.vision === 'unknown')],
      ['Text only (won’t work)', list.filter((m) => m.vision === 'no')],
    ];
    const empty = all.length === 0 ? 'Click “Load models” first' : 'No vision models found (untick the filter)';
    modelSelect.replaceChildren(
      ...(list.length ? [] : [el('option', { value: '', disabled: '' }, empty)]),
      ...groups.filter(([, g]) => g.length).map(([label, g]) => el('optgroup', { label }, g.map(option))),
      el('option', { value: CUSTOM }, 'Other… (type a name)'),
    );
    const usable = list.find((m) => m.vision !== 'no') ?? list[0];
    modelSelect.value = list.some((m) => m.id === prefer) ? prefer : (usable?.id ?? '');
    syncCustom();
  };
  const syncCustom = () => {
    customModel.hidden = modelSelect.value !== CUSTOM;
  };
  const modelValue = () => (modelSelect.value === CUSTOM ? customModel.value : modelSelect.value).trim();
  modelSelect.addEventListener('change', () => {
    syncCustom();
    if (!customModel.hidden) customModel.focus();
    notify();
  });
  customModel.addEventListener('input', notify);
  visionOnly.addEventListener('change', () => {
    setModels(ids);
    notify();
  });

  const refresh = () => {
    if (isSame()) return refreshSame();
    providerRow.hidden = loadBtn.hidden = false;
    const k = slotKind();
    const remote = k === 'openai' || k === 'anthropic';
    urlRow.hidden = k !== 'openai';
    keyRow.hidden = modelRow.hidden = !remote;
    visionRow.hidden = !remote || doodler;
    status.textContent = '';
    help.textContent = '';
    if (k === 'openai') {
      const p = OPENAI_PRESETS[Number(kind.value.split(':')[1])];
      baseUrl.value = p.baseUrl;
      help.textContent = p.keyless
        ? 'No key needed; click “Load models”. Ollama must allow this site: set OLLAMA_ORIGINS. Safari may block http://localhost from an https page.'
        : 'Enter your key, then click “Load models”.';
    }
    if (k === 'anthropic') help.textContent = 'Enter your key, then click “Load models”.';
    if (remote) setModels([], '');
    help.hidden = !help.textContent;
    notify();
  };

  // Mirror the leader's provider; default to a different model than the leader's.
  const refreshSame = () => {
    providerRow.hidden = urlRow.hidden = keyRow.hidden = loadBtn.hidden = help.hidden = true;
    status.textContent = '';
    modelRow.hidden = leader!.kind() === 'fake';
    visionRow.hidden = modelRow.hidden || doodler;
    const list = leader!.models();
    const keep = modelValue();
    const other = list.find((m) => m.id !== leader!.model() && m.vision !== 'no') ?? list[0];
    setModels(list, list.some((m) => m.id === keep) ? keep : other?.id);
  };

  const read = (): GuesserConfig => {
    if (isSame()) {
      const c = leader!.read();
      return c.kind === 'fake' ? c : { ...c, model: modelValue() };
    }
    switch (slotKind()) {
      case 'fake':
        return { kind: 'fake' };
      case 'openai':
        return { kind: 'openai', baseUrl: baseUrl.value.trim(), apiKey: apiKey.value.trim(), model: modelValue() };
      case 'anthropic':
        return { kind: 'anthropic', apiKey: apiKey.value.trim(), model: modelValue() };
    }
  };

  kind.addEventListener('change', refresh);
  sameBox.addEventListener('change', refresh);
  leader?.onChange(() => isSame() && refreshSame());

  loadBtn.addEventListener('click', async () => {
    const c = read();
    status.textContent = 'Loading models…';
    try {
      // Where the provider's own list doesn't say, fall back to models.dev's image support.
      const ids = sortModels(
        (await listModels(c)).map((m) => {
          if (m.vision === 'yes' || m.vision === 'no') return m;
          const img = catalogVision(c, m.id);
          return img === undefined ? m : { ...m, vision: img ? ('yes' as const) : ('no' as const) };
        }),
      );
      setModels(ids);
      notify();
      const vision = ids.filter((m) => m.vision === 'yes' || m.vision === 'likely').length;
      status.textContent = doodler
        ? `${ids.length} models loaded. Any chat model can doodle.`
        : `${ids.length} models loaded, ${vision} accept images. “(likely)” is a guess from the name.`;
    } catch (e) {
      status.textContent = `Could not load models: ${errorText(e)}`;
    }
  });

  testBtn.addEventListener('click', async () => {
    const c = read();
    status.textContent = 'Testing…';
    if (doodler) {
      try {
        const { strokes } = await createDoodler(c).draw('sun', AbortSignal.timeout(90000));
        status.textContent = `Works. It drew a test sun with ${strokes.length} strokes.`;
      } catch (e) {
        status.textContent = `Hmm, that didn’t work: ${errorText(e)}`;
      }
      return;
    }
    try {
      const g = createGuesser(c, { target: () => ({ word: 'circle' }), progress: () => 1, difficulty: () => 0 });
      const { guess, confidence } = await g.guess({ image: testImage(), wrongGuesses: [], signal: AbortSignal.timeout(30000) });
      const sure = confidence === null ? '' : ` (${confidence}% sure)`;
      status.textContent = `Works. It sees a test circle as: “${guess}”${sure}`;
    } catch (e) {
      status.textContent = `Hmm, that didn’t work: ${errorText(e)}`;
    }
  });

  const removeBtn = el('button', { type: 'button', class: 'icon-btn remove', title: 'Remove this Doodlebot', 'aria-label': `Remove Doodlebot #${n}` }, '✕');
  if (doodler) removeBtn.hidden = true;
  const root = el('div', { class: doodler ? 'slot card doodler-slot' : `slot card p${n - 1}` }, [
    el('div', { class: 'slot-head' }, doodler ? [doodlerBot(), el('h2', {}, 'Doodler bot ✏️'), removeBtn] : [robot(n - 1), el('h2', {}, `Doodlebot #${n}`), removeBtn]),
    sameRow,
    providerRow,
    urlRow,
    keyRow,
    modelRow,
    visionRow,
    help,
    el('div', { class: 'row' }, [testBtn]),
    status,
  ]);
  refresh();
  return {
    root,
    removeBtn,
    read,
    kind: () => (isSame() ? leader!.kind() : slotKind()),
    models: () => ids,
    model: modelValue,
    onChange: (fn) => listeners.push(fn),
  };
}

/** Make a card clickable (and keyboard-pressable) to pick it. */
function pickCard(card: HTMLElement, onPick: () => void): HTMLElement {
  card.classList.add('pick');
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.addEventListener('click', onPick);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPick();
    }
  });
  return card;
}

function setPicked(card: HTMLElement, picked: boolean) {
  card.classList.toggle('picked', picked);
  card.setAttribute('aria-pressed', String(picked));
}

function errorText(e: unknown): string {
  if (e instanceof GuessError) return e.message;
  if (e instanceof DOMException && e.name === 'TimeoutError') return 'Timed out';
  return (e as Error)?.message ?? String(e);
}

function select(options: string[][], value: string): HTMLSelectElement {
  const s = el('select', {}, options.map(([v, label]) => el('option', { value: v }, label))) as HTMLSelectElement;
  s.value = value;
  return s;
}

function field(label: string, control: HTMLElement): HTMLElement {
  return el('label', { class: 'field' }, [el('span', {}, label), control]);
}

/** A small circle on white, for the Test button. */
function testImage(): string {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 128, 128);
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(64, 64, 40, 0, Math.PI * 2);
  ctx.stroke();
  return c.toDataURL('image/jpeg', 0.9);
}
