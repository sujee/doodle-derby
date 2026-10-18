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
import { botColor, doodlerBot, robot, you } from './art';
import { createDoodler } from './doodler';
import { el } from './dom';

const CUSTOM = '__custom__';
/**
 * The doodler picker (You | Bot) is off: the bot-doodler mode is being rethought. Its code stays
 * (doodler.ts, Engine's doodler option, the game's watch mode); set true to bring the picker back.
 */
const SHOW_DOODLER_PICK = false;

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
  /** Pick a random model that no other bot has (when added with Add bot). */
  reroll(): void;
  /** Use Bot #1's provider with this model (Add all image models). */
  useModel(id: string): void;
  /** Re-label after the list changed (number, robot, color). */
  setNumber(n: number): void;
  /** Follow the leader: show/hide "Same provider as Bot #1" and mirror its provider. */
  syncLeader(): void;
};


/** A random model that can see images and isn't in avoid; any image model if all are taken. */
export function pickModel(list: ModelInfo[], avoid: string[], random = Math.random): string | undefined {
  const usable = list.filter((m) => m.vision !== 'no');
  const fresh = usable.filter((m) => !avoid.includes(m.id));
  const pool = fresh.length ? fresh : usable.length ? usable : list;
  return pool[Math.floor(random() * pool.length)]?.id;
}

/** Render the setup screen. Calls onStart with the guesser configs (one or more), plus the doodler bot's config when a bot draws. */
export function renderSetup(container: HTMLElement, onStart: (configs: GuesserConfig[], doodler: GuesserConfig | null) => void) {
  container.replaceChildren();
  // The visible bots, in order. Adding appends; the ✕ removes one and the rest renumber (Bot #1, #2…).
  const slots: Slot[] = [];
  /** True while re-syncing, so a refresh can't trigger another one (refresh → notify → sync). */
  let syncing = false;
  /** The models the other bots already use, so a new bot picks a different one. */
  const takenBy = (self: Slot) => slots.filter((s) => s !== self).map((s) => s.model());
  // Bot #1's "Add all N image models": one bot per image model of its provider, no limit.
  const addAll = (ids: string[]) => {
    const rest = ids.filter((id) => id !== slots[0].model());
    while (slots.length > 1) removeSlot(slots[slots.length - 1]);
    rest.forEach((id) => addSlot().useModel(id));
    renumber();
    slots[slots.length - 1].root.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  };
  const first = makeSlot(1, () => undefined, false, () => [], addAll);
  slots.push(first);
  // A bot's leader is the first other bot (usually Bot #1), so "Same provider as…" survives a removal.
  const addSlot = () => {
    let self!: Slot;
    // The leader is the current Bot #1; the first bot itself has none (it would mirror itself).
    const s = makeSlot(slots.length + 1, () => (slots[0] === self ? undefined : slots[0]), false, () => takenBy(self));
    self = s;
    wire(s);
    slots.push(s);
    guesserRow.insertBefore(s.root, add);
    return s;
  };
  const doodlerSlot = makeSlot(0, () => slots[0], true);

  // Pick the doodler: click the You card or the Bot card. The picked card is highlighted; a picked
  // Bot shows its model settings below, and You become one of the guessers.
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
    el('p', { class: 'pick-label' }, SHOW_DOODLER_PICK ? [el('span', { class: 'step-num' }, '2'), 'Pick the guessers'] : 'Pick the guessers'),
    guesserRow,
  ]);
  const addLabel = el('span');
  const add = el('button', { type: 'button', class: 'add-bot' }, [
    el('span', { class: 'plus', 'aria-hidden': 'true' }, '+'),
    addLabel,
  ]);
  const error = el('p', { class: 'error', role: 'alert' });
  const note = el('p', { class: 'note' }, 'Your API keys stay in this tab. They’re never saved and only go to the endpoint you pick.');
  const syncNote = () => (note.hidden = ![...slots, ...(botDraws ? [doodlerSlot] : [])].some((s) => s.kind() !== 'fake'));
  const syncSlots = () => {
    if (syncing) return;
    syncing = true;
    try {
      slots.forEach((s) => s.syncLeader());
    } finally {
      syncing = false;
    }
  };
  const wire = (s: Slot) => {
    s.removeBtn.addEventListener('click', () => removeSlot(s));
    s.onChange(() => {
      syncNote();
      syncSlots();
    });
  };
  /** Drop a bot; the others keep their state and take the numbers 1..N again. */
  const removeSlot = (s: Slot) => {
    const i = slots.indexOf(s);
    if (i < 0 || slots.length <= 1) return; // always keep one guesser
    slots.splice(i, 1);
    s.root.remove();
    renumber();
  };
  const renumber = () => {
    slots.forEach((s, i) => {
      s.setNumber(i + 1);
      s.removeBtn.hidden = slots.length <= 1; // the last bot can't be removed
    });
    addLabel.textContent = `Bot #${slots.length + 1}`;
    add.setAttribute('aria-label', `Add Bot #${slots.length + 1}`);
    error.textContent = '';
    syncNote();
    syncSlots();
  };
  const setMode = (bot: boolean) => {
    botDraws = bot;
    lede.textContent = bot ? 'A bot doodles. The other bots race to guess it. You watch.' : 'You doodle. The bots guess. Fastest bot wins.';
    youRole.textContent = bot ? 'watching 👀' : 'the doodler ✏️';
    setPicked(youCard, !bot);
    setPicked(botCard, bot);
    // A picked Bot keeps its card (highlighted) and shows its settings below both cards.
    doodlerSide.replaceChildren(doodlerSide.firstChild!, youCard, botCard, ...(bot ? [doodlerSlot.root] : []));
    guesserRow.replaceChildren(...slots.map((s) => s.root), add);
    slotsEl.replaceChildren(...(SHOW_DOODLER_PICK ? [doodlerSide, vs] : []), guessersSide);
    syncNote();
  };
  doodlerSlot.onChange(syncNote);
  add.addEventListener('click', () => {
    const s = addSlot();
    s.reroll();
    s.root.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    renumber();
  });
  wire(first);
  setMode(false);
  renumber();
  const start = el('button', { class: 'primary big start' }, 'Play!');
  start.addEventListener('click', () => {
    const configs: GuesserConfig[] = [];
    for (const s of slots) {
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
      el('h1', { class: 'logo' }, [robot(0), el('span', {}, [el('span', { class: 'w1' }, 'Doodle'), ' ', el('span', { class: 'w2' }, 'Derby')]), robot(1)]),
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
function makeSlot(
  n: number,
  /** The bot to mirror ("Same provider as Bot #1"), or undefined for Bot #1 itself. */
  leader: () => Slot | undefined = () => undefined,
  doodler = false,
  taken: () => string[] = () => [],
  /** Bot #1 only: offered once the model list loads, when the provider has 2+ image models. */
  addAll?: (ids: string[]) => void,
): Slot {
  // One flat provider list: OpenAI-compatible presets are "openai:<index>".
  // Fake guesser first (the no-key default), real providers A–Z, generic "OpenAI compatible" last.
  const presets = OPENAI_PRESETS.map((p, i) => [`openai:${i}`, p.name]);
  const generic = presets.filter(([, name]) => name === 'OpenAI compatible');
  const named = [['anthropic', 'Anthropic'], ...presets.filter((p) => !generic.includes(p))];
  named.sort((a, b) => a[1].localeCompare(b[1]));
  const kind = select([['fake', doodler ? 'Fake doodler (no key)' : 'Fake guesser (no key)'], ...named, ...generic], 'fake');
  const baseUrl = el('input', { type: 'url', placeholder: 'https://…/v1' }) as HTMLInputElement;
  const apiKey = el('input', { type: 'password', autocomplete: 'off', placeholder: 'API key' }) as HTMLInputElement;
  const modelSelect = el('select', { 'aria-label': 'Model' }) as HTMLSelectElement;
  const customModel = el('input', { placeholder: 'Type a model name' }) as HTMLInputElement;
  const visionOnly = el('input', { type: 'checkbox' }) as HTMLInputElement;
  visionOnly.checked = !doodler; // drawing doesn't need image input
  // Load / refresh the model list; a small icon sits beside the box (empty until it is loaded).
  const loadBtn = el('button', { type: 'button', class: 'icon-btn refresh', title: 'Load the model list', 'aria-label': 'Load the model list' }, '⟳');
  const testBtn = el('button', { type: 'button' }, 'Test');
  const status = el('p', { class: 'status' });
  const addAllBtn = el('button', { type: 'button', class: 'add-all', hidden: '' });
  let visionIds: string[] = [];
  addAllBtn.addEventListener('click', () => addAll?.(visionIds));
  const help = el('p', { class: 'note' });

  const urlRow = field('API URL', baseUrl);
  const keyRow = field('API key', apiKey);
  const providerRow = field('Provider', kind);
  const sameBox = el('input', { type: 'checkbox' }) as HTMLInputElement;
  sameBox.checked = !!leader();
  const sameRow = el('label', { class: 'check' }, [sameBox, 'Same provider as Bot #1']);
  sameRow.hidden = !leader();
  const isSame = () => !!leader() && sameBox.checked;
  let ids: ModelInfo[] = [];
  const listeners: (() => void)[] = [];
  const notify = () => listeners.forEach((fn) => fn());

  const modelRow = el('div', { class: 'field' }, [
    // "Model" with the reload on its right; the box then gets the full card width for long names.
    el('div', { class: 'field-head' }, [el('span', {}, 'Model'), loadBtn]),
    el('div', { class: 'stack' }, [modelSelect, customModel]),
  ]);
  const visionRow = el('label', { class: 'check small' }, [visionOnly, 'Only show models that can see images']);

  const slotKind = (): ProviderKind => kind.value.split(':')[0] as ProviderKind;

  // A real <select> (datalist suggestions filter by the typed text and are flaky in Safari).
  // Grouped so image-capable models come first; text-only ones are still pickable but flagged.
  const setModels = (all: ModelInfo[], prefer = modelValue()) => {
    ids = all;
    if (!all.length) addAllBtn.hidden = true; // provider changed: its list is gone
    const list = visionOnly.checked ? all.filter((m) => m.vision === 'yes' || m.vision === 'likely') : all;
    const option = (m: ModelInfo) => el('option', { value: m.id }, m.vision === 'likely' ? `${m.id} (likely)` : m.id);
    const groups: [string, ModelInfo[]][] = [
      ['Accepts images', list.filter((m) => m.vision === 'yes' || m.vision === 'likely')],
      ['Unknown (use Test to check)', list.filter((m) => m.vision === 'unknown')],
      ['Text only (won’t work)', list.filter((m) => m.vision === 'no')],
    ];
    const empty = all.length === 0 ? 'Click ⟳ to load the models' : 'No vision models found (untick the filter)';
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
    sameRow.hidden = !leader();
    providerRow.hidden = false;
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
      if (p.keyless) help.textContent = 'No key needed; click ⟳ to load models. Ollama must allow this site: set OLLAMA_ORIGINS. Safari may block http://localhost from an https page.';
    }
    if (remote) setModels([], '');
    help.hidden = !help.textContent;
    notify();
  };

  // Mirror the leader's provider; default to a model no other bot uses (random when fresh).
  const refreshSame = (fresh = false) => {
    const lead = leader();
    if (!lead) return;
    providerRow.hidden = urlRow.hidden = keyRow.hidden = help.hidden = true;
    status.textContent = '';
    modelRow.hidden = lead.kind() === 'fake';
    visionRow.hidden = modelRow.hidden || doodler;
    const list = lead.models();
    const keep = modelValue();
    const avoid = taken();
    setModels(list, !fresh && list.some((m) => m.id === keep) && !avoid.includes(keep) ? keep : pickModel(list, avoid));
  };

  const read = (): GuesserConfig => {
    if (isSame()) {
      const c = leader()!.read();
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
      visionIds = ids.filter((m) => m.vision === 'yes' || m.vision === 'likely').map((m) => m.id);
      const vision = visionIds.length;
      addAllBtn.textContent = `＋ Add all ${vision} image models`;
      addAllBtn.hidden = !addAll || vision < 2;
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

  const removeBtn = el('button', { type: 'button', class: 'icon-btn remove', title: 'Remove this bot', 'aria-label': `Remove Bot #${n}` }, '✕');
  if (doodler) removeBtn.hidden = true;
  // Colours and robots repeat every three bots; the head is rebuilt when the list is renumbered.
  const avatar = el('span', { class: 'slot-avatar', 'aria-hidden': 'true' }, doodler ? doodlerBot() : robot(n - 1));
  const title = el('h2', {}, doodler ? 'Doodler bot ✏️' : `Bot #${n}`);
  const root = el('div', { class: doodler ? 'slot card doodler-slot' : `slot card p${(n - 1) % 3}` }, [
    el('div', { class: 'slot-head' }, [avatar, title, removeBtn]),
    sameRow,
    providerRow,
    urlRow,
    keyRow,
    modelRow,
    visionRow,
    help,
    el('div', { class: 'row' }, [testBtn]),
    status,
    addAllBtn,
  ]);
  if (!doodler) root.style.setProperty('--lane', botColor(n - 1));
  refresh();
  return {
    root,
    removeBtn,
    read,
    kind: () => (isSame() ? leader()!.kind() : slotKind()),
    models: () => ids,
    model: modelValue,
    onChange: (fn) => listeners.push(fn),
    useModel: (id) => {
      sameBox.checked = true;
      refreshSame();
      modelSelect.value = id;
      syncCustom();
      notify();
    },
    reroll: () => {
      if (isSame()) refreshSame(true);
      else if (ids.length) setModels(ids, pickModel(ids, taken()));
      notify();
    },
    setNumber: (num) => {
      if (doodler) return;
      root.className = `slot card p${(num - 1) % 3}`;
      root.style.setProperty('--lane', botColor(num - 1));
      avatar.replaceChildren(robot(num - 1));
      title.textContent = `Bot #${num}`;
      removeBtn.setAttribute('aria-label', `Remove Bot #${num}`);
    },
    syncLeader: () => {
      const lead = leader();
      sameRow.hidden = !lead;
      if (!lead) {
        if (sameBox.checked) {
          sameBox.checked = false; // its leader is gone: back to picking a provider
          refresh();
        }
        return;
      }
      if (sameBox.checked) refreshSame();
    },
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
