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
import { isMatch } from './match';
import type { Word } from './words';

const CUSTOM = '__custom__';
/** Can the model see the doodle (picture in → words out)? A short label under its name, the longer story on hover. */
const VISION_LABEL: Record<ModelInfo['vision'], string> = { yes: '🖼️ → 💬', likely: '🖼️ → 💬 ?', unknown: '🖼️ ? · Test it', no: '💬 only · can’t see' };
const VISION_HINT: Record<ModelInfo['vision'], string> = {
  yes: 'Takes images: it can see your doodle',
  likely: 'Probably takes images (a guess from its name)',
  unknown: 'Not sure it takes images: use Test to check',
  no: 'Text only: it can’t see your doodle',
};
/**
 * The doodler picker (You | Bot) is off: the bot-doodler mode is being rethought. Its code stays
 * (doodler.ts, Engine's doodler option, the game's watch mode); set true to bring the picker back.
 */
const SHOW_DOODLER_PICK = false;

/** Where the bots come from: a provider, its key (and URL), and the model list it offers. */
type Conn = {
  root: HTMLElement;
  /** Room under the status line for extra buttons (Add all). */
  footer: HTMLElement;
  kind(): ProviderKind;
  /** The config for one bot on this provider. */
  config(model: string): GuesserConfig;
  /** The models offered, with the "image models only" filter applied. */
  models(): ModelInfo[];
  /** All loaded models that accept images. */
  imageIds(): string[];
  /** Called when the provider, the model list, or the filter changes. */
  onChange(fn: () => void): void;
};

type Bot = {
  root: HTMLElement;
  removeBtn: HTMLElement;
  read(): GuesserConfig;
  kind(): ProviderKind;
  model(): string;
  /** True while this bot uses the shared provider (not its own). */
  shared(): boolean;
  /** Re-pick the model after its list changed; fresh = pick a new random one even if the old one still fits. */
  assign(fresh?: boolean): void;
  /** Use the shared provider with this model (Add all image models). */
  useModel(id: string): void;
  /** Re-label after the list changed (number, robot, color). */
  setNumber(n: number): void;
};

/**
 * What this tab remembers between setup screens, in memory only (never saved): each provider's key
 * and URL once its models loaded, the model lists, and the shared provider picked last. So "Change
 * bots" doesn't ask for the key again, and the model list shows at once.
 */
const memory = {
  provider: 'fake',
  keys: new Map<string, string>(),
  urls: new Map<string, string>(),
  models: new Map<string, ModelInfo[]>(),
};

/** Forget the remembered keys and lists (tests). */
export function forgetProviders() {
  memory.provider = 'fake';
  memory.keys.clear();
  memory.urls.clear();
  memory.models.clear();
}

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
  // One provider for everybody, set once above the cards. A bot can still switch to its own.
  const shared = makeConnection(false, false, true);
  // The visible bots, in order. Adding appends; the ✕ removes one and the rest renumber (Bot #1, #2…).
  const bots: Bot[] = [];
  /** The models the other bots already use, so a new bot picks a different one. */
  const takenBy = (self: Bot) => bots.filter((b) => b !== self).map((b) => b.model());
  const addBot = () => {
    let self!: Bot;
    const b = makeBot(bots.length + 1, shared, () => takenBy(self), false, () => syncNote());
    self = b;
    b.removeBtn.addEventListener('click', () => removeBot(b));
    bots.push(b);
    guesserRow.insertBefore(b.root, add);
    return b;
  };
  const doodlerBotCard = makeBot(0, shared, () => [], true, () => syncNote());

  // "Add all N image models": one bot per image model of the shared provider, no limit.
  const addAllBtn = el('button', { type: 'button', class: 'add-all', hidden: '' });
  shared.footer.append(addAllBtn);
  addAllBtn.addEventListener('click', () => {
    const ids = shared.imageIds();
    while (bots.length > 1) removeBot(bots[bots.length - 1]);
    bots[0].useModel(ids[0]);
    ids.slice(1).forEach((id) => addBot().useModel(id));
    renumber();
  });
  shared.onChange(() => {
    // Bots go in order, so each one avoids the models the bots before it just took.
    bots.filter((b) => b.shared()).forEach((b) => b.assign());
    const n = shared.imageIds().length;
    addAllBtn.textContent = `＋ Add all ${n} image models`;
    addAllBtn.hidden = n < 2;
    syncNote();
  });

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
    shared.root,
    guesserRow,
  ]);
  const addLabel = el('span');
  const add = el('button', { type: 'button', class: 'add-bot' }, [
    el('span', { class: 'plus', 'aria-hidden': 'true' }, '+'),
    addLabel,
  ]);
  const error = el('p', { class: 'error', role: 'alert' });
  const note = el('p', { class: 'note' }, 'Your API keys stay in this tab until you reload. They’re never saved and only go to the endpoint you pick.');
  const syncNote = () => (note.hidden = ![...bots, ...(botDraws ? [doodlerBotCard] : [])].some((b) => b.kind() !== 'fake'));
  /** Drop a bot; the others keep their state and take the numbers 1..N again. */
  const removeBot = (b: Bot) => {
    const i = bots.indexOf(b);
    if (i < 0 || bots.length <= 1) return; // always keep one guesser
    bots.splice(i, 1);
    b.root.remove();
    renumber();
  };
  const renumber = () => {
    bots.forEach((b, i) => {
      b.setNumber(i + 1);
      b.removeBtn.hidden = bots.length <= 1; // the last bot can't be removed
    });
    addLabel.textContent = `Bot #${bots.length + 1}`;
    add.setAttribute('aria-label', `Add Bot #${bots.length + 1}`);
    error.textContent = '';
    syncNote();
  };
  const setMode = (bot: boolean) => {
    botDraws = bot;
    lede.textContent = bot ? 'A bot doodles. The other bots race to guess it. You watch.' : 'You doodle. The bots guess. Fastest bot wins.';
    youRole.textContent = bot ? 'watching 👀' : 'the doodler ✏️';
    setPicked(youCard, !bot);
    setPicked(botCard, bot);
    // A picked Bot keeps its card (highlighted) and shows its settings below both cards.
    doodlerSide.replaceChildren(doodlerSide.firstChild!, youCard, botCard, ...(bot ? [doodlerBotCard.root] : []));
    guesserRow.replaceChildren(...bots.map((b) => b.root), add);
    slotsEl.replaceChildren(...(SHOW_DOODLER_PICK ? [doodlerSide, vs] : []), guessersSide);
    syncNote();
  };
  add.addEventListener('click', () => {
    const b = addBot();
    b.assign(true);
    b.root.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    renumber();
  });
  setMode(false);
  addBot();
  renumber();
  const start = el('button', { class: 'primary big start' }, 'Play!');
  start.addEventListener('click', () => {
    const configs: GuesserConfig[] = [];
    for (const b of bots) {
      const c = b.read();
      if (c.kind !== 'fake' && !c.model) return void (error.textContent = 'Pick a model for each Doodlebot first.');
      if (c.kind === 'openai' && !c.baseUrl) return void (error.textContent = 'Enter the API URL.');
      configs.push(c);
    }
    let doodler: GuesserConfig | null = null;
    if (botDraws) {
      doodler = doodlerBotCard.read();
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
 * A provider picker: provider, API URL (generic OpenAI-compatible only), API key, and the model list.
 * The list loads by itself once there is a key (⟳ loads it again). stacked = inside a bot card.
 */
function makeConnection(doodler = false, stacked = false, isShared = false): Conn {
  // One flat provider list: OpenAI-compatible presets are "openai:<index>".
  // Fake guesser first (the no-key default), real providers A–Z, generic "OpenAI compatible" last.
  const presets = OPENAI_PRESETS.map((p, i) => [`openai:${i}`, p.name]);
  const generic = presets.filter(([, name]) => name === 'OpenAI compatible');
  const named = [['anthropic', 'Anthropic'], ...presets.filter((p) => !generic.includes(p))];
  named.sort((a, b) => a[1].localeCompare(b[1]));
  const kind = select([['fake', doodler ? 'Fake doodler (no key)' : 'Fake guesser (no key)'], ...named, ...generic], isShared ? memory.provider : 'fake');
  const baseUrl = el('input', { type: 'url', placeholder: 'https://…/v1' }) as HTMLInputElement;
  const apiKey = el('input', { type: 'password', autocomplete: 'off', placeholder: 'API key' }) as HTMLInputElement;
  const loadBtn = el('button', { type: 'button', class: 'icon-btn refresh', title: 'Load the model list', 'aria-label': 'Load the model list' }, '⟳');
  const visionOnly = el('input', { type: 'checkbox' }) as HTMLInputElement;
  visionOnly.checked = !doodler; // drawing doesn't need image input
  const visionRow = el('label', { class: 'check small' }, [visionOnly, 'Image models only']);
  const status = el('p', { class: 'status' });
  const help = el('p', { class: 'note' });
  const footer = el('div', { class: 'conn-foot' }, [status, ...(doodler ? [] : [visionRow])]);

  const urlRow = field('API URL', baseUrl);
  const keyRow = field('API key', apiKey);
  // Once a provider's key worked, it isn't asked for again: a short "Key set" line, with Change to type a new one.
  const changeKey = el('button', { type: 'button', class: 'link-btn' }, 'Change');
  const keySet = el('p', { class: 'key-set' }, [el('span', {}, '🔑 Key set'), changeKey]);
  let editingKey = false;
  const root = el('div', { class: stacked ? 'conn stacked' : 'conn card' }, [
    el('div', { class: 'conn-fields' }, [field('Provider', kind), urlRow, keyRow, keySet, loadBtn]),
    help,
    footer,
  ]);

  let all: ModelInfo[] = [];
  const listeners: (() => void)[] = [];
  const notify = () => listeners.forEach((fn) => fn());
  const slotKind = (): ProviderKind => kind.value.split(':')[0] as ProviderKind;
  const preset = () => (slotKind() === 'openai' ? OPENAI_PRESETS[Number(kind.value.split(':')[1])] : undefined);
  const config = (model: string): GuesserConfig => {
    switch (slotKind()) {
      case 'fake':
        return { kind: 'fake' };
      case 'openai':
        return { kind: 'openai', baseUrl: baseUrl.value.trim(), apiKey: apiKey.value.trim(), model };
      case 'anthropic':
        return { kind: 'anthropic', apiKey: apiKey.value.trim(), model };
    }
  };

  /** Models are remembered per provider, URL and key. */
  const listKey = () => `${kind.value}|${baseUrl.value.trim()}|${apiKey.value.trim()}`;
  const showList = (list: ModelInfo[]) => {
    all = list;
    status.textContent = doodler ? `✓ ${list.length} models. Any chat model can doodle.` : `✓ ${list.length} models, ${imageIds().length} see images`;
    notify();
  };
  const showKey = () => {
    const needed = slotKind() !== 'fake' && !preset()?.keyless;
    const known = memory.keys.has(kind.value) && !editingKey;
    keyRow.hidden = !needed || known;
    keySet.hidden = !needed || !known;
  };

  /** Bumped on every load and provider change, so a slow, stale list never lands. */
  let loadId = 0;
  const load = async () => {
    const id = ++loadId;
    const c = config('');
    status.textContent = 'Loading models…';
    try {
      // Where the provider's own list doesn't say, fall back to models.dev's image support.
      const list = sortModels(
        (await listModels(c)).map((m) => {
          if (m.vision === 'yes' || m.vision === 'no') return m;
          const img = catalogVision(c, m.id);
          return img === undefined ? m : { ...m, vision: img ? ('yes' as const) : ('no' as const) };
        }),
      );
      if (id !== loadId) return;
      memory.models.set(listKey(), list);
      if (c.kind !== 'fake' && c.apiKey) memory.keys.set(kind.value, c.apiKey);
      if (c.kind === 'openai') memory.urls.set(kind.value, c.baseUrl);
      editingKey = false;
      showKey();
      showList(list);
    } catch (e) {
      if (id !== loadId) return;
      status.textContent = `Couldn’t load the models: ${errorText(e)}`;
    }
  };
  const imageIds = () => all.filter((m) => m.vision === 'yes' || m.vision === 'likely').map((m) => m.id);
  /** Load when there is enough to go on: a key (or a keyless provider) and a URL. */
  const autoLoad = () => {
    const p = preset();
    if (slotKind() === 'fake' || !baseUrl.value.trim() && slotKind() === 'openai') return;
    if (!apiKey.value.trim() && !p?.keyless) return;
    const known = memory.models.get(listKey());
    if (known) showList(known);
    else void load();
  };

  const refresh = () => {
    loadId++;
    const k = slotKind();
    const remote = k !== 'fake';
    const p = preset();
    urlRow.hidden = !p || !!p.baseUrl; // presets know their URL; only the generic one asks
    apiKey.value = memory.keys.get(kind.value) ?? '';
    editingKey = false;
    showKey();
    if (isShared) memory.provider = kind.value;
    loadBtn.hidden = visionRow.hidden = !remote;
    visionRow.hidden ||= doodler;
    baseUrl.value = p?.baseUrl ?? memory.urls.get(kind.value) ?? '';
    help.textContent = p?.keyless ? 'No key needed. Ollama must allow this site: set OLLAMA_ORIGINS. Safari may block http://localhost from an https page.' : '';
    help.hidden = !help.textContent;
    all = [];
    status.textContent = !remote ? 'No key needed. Pretend bots, for trying the game.' : p?.keyless ? '' : 'Enter your API key to load the models.';
    notify();
    autoLoad();
  };

  let typing: ReturnType<typeof setTimeout> | undefined;
  const loadSoon = () => {
    clearTimeout(typing);
    typing = setTimeout(autoLoad, 600);
  };
  kind.addEventListener('change', refresh);
  apiKey.addEventListener('input', loadSoon);
  baseUrl.addEventListener('input', loadSoon);
  loadBtn.addEventListener('click', () => void load());
  changeKey.addEventListener('click', () => {
    editingKey = true;
    showKey();
    apiKey.select();
    apiKey.focus();
  });
  visionOnly.addEventListener('change', notify);
  refresh();

  return {
    root,
    footer,
    kind: slotKind,
    config,
    models: () => (visionOnly.checked ? all.filter((m) => m.vision === 'yes' || m.vision === 'likely') : all),
    imageIds,
    onChange: (fn) => listeners.push(fn),
  };
}

/**
 * One bot card: its robot, its model and a Test button. It uses the shared provider unless it is
 * switched to its own. The doodler card (doodler = true) always has its own provider, and Test asks for a drawing.
 */
function makeBot(n: number, shared: Conn, taken: () => string[], doodler = false, onOwnChange?: () => void): Bot {
  let own: Conn | null = null;
  const conn = () => own ?? shared;
  const ownBox = el('div', { class: 'own-conn' });
  const ownBtn = el('button', { type: 'button', class: 'link-btn' });

  // The real <select> sits invisibly over a label that shows the whole id: "org/" small, the name below.
  const modelSelect = el('select', { 'aria-label': 'Model' }) as HTMLSelectElement;
  const org = el('span', { class: 'model-org' });
  const name = el('span', { class: 'model-name' });
  const vis = el('span', { class: 'model-vis' });
  const modelPick = el('div', { class: 'model-pick' }, [org, name, vis, modelSelect]);
  const customModel = el('input', { placeholder: 'Type a model name' }) as HTMLInputElement;
  const fakeNote = el('p', { class: 'fake-note' }, doodler ? 'Fake doodler' : 'Fake guesser');
  const testBtn = el('button', { type: 'button' }, 'Test');
  const status = el('p', { class: 'status' });

  const modelValue = () => (modelSelect.value === CUSTOM ? customModel.value : modelSelect.value).trim();
  const showLabel = () => {
    const id = modelSelect.value;
    const m = conn().models().find((x) => x.id === id);
    const cut = id.lastIndexOf('/');
    org.textContent = id && id !== CUSTOM && cut > 0 ? id.slice(0, cut + 1) : '';
    name.textContent = id === CUSTOM ? 'Other…' : id ? id.slice(cut + 1) : modelSelect.selectedOptions[0]?.textContent ?? '';
    vis.textContent = !m ? '' : VISION_LABEL[m.vision];
    vis.title = !m ? '' : VISION_HINT[m.vision];
    vis.dataset.vision = m?.vision ?? '';
    customModel.hidden = id !== CUSTOM;
  };

  // A real <select> (datalist suggestions filter by the typed text and are flaky in Safari).
  // Grouped so image-capable models come first; text-only ones are still pickable but flagged.
  const render = (prefer: string | undefined) => {
    const list = conn().models();
    const option = (m: ModelInfo) => el('option', { value: m.id }, m.vision === 'likely' ? `${m.id} (probably)` : m.id);
    const groups: [string, ModelInfo[]][] = [
      ['🖼️ → 💬 Sees images', list.filter((m) => m.vision === 'yes' || m.vision === 'likely')],
      ['🖼️ ? Not sure (use Test to check)', list.filter((m) => m.vision === 'unknown')],
      ['💬 only: can’t see images (won’t work)', list.filter((m) => m.vision === 'no')],
    ];
    modelSelect.replaceChildren(
      ...(list.length ? [] : [el('option', { value: '', disabled: '' }, 'Models load once the provider is set')]),
      ...groups.filter(([, g]) => g.length).map(([label, g]) => el('optgroup', { label }, g.map(option))),
      el('option', { value: CUSTOM }, 'Other… (type a name)'),
    );
    const usable = list.find((m) => m.vision !== 'no') ?? list[0];
    modelSelect.value = prefer === CUSTOM || list.some((m) => m.id === prefer) ? prefer! : (usable?.id ?? '');
    const fake = conn().kind() === 'fake';
    modelPick.hidden = fake;
    fakeNote.hidden = !fake;
    status.textContent = '';
    showLabel();
  };
  // Keep the model if it is still offered and nobody else has it; else a random free one.
  // The pick comes from the offered (filtered) list, so it can't fall back to someone else's model.
  const assign = (fresh = false) => {
    const keep = modelSelect.value;
    const list = conn().models();
    const avoid = taken();
    const keepOk = !fresh && (keep === CUSTOM || (list.some((m) => m.id === keep) && !avoid.includes(keep)));
    render(keepOk ? keep : pickModel(list, avoid));
  };

  modelSelect.addEventListener('change', () => {
    showLabel();
    status.textContent = '';
    if (!customModel.hidden) customModel.focus();
  });

  const setOwn = (on: boolean) => {
    own = on ? makeConnection(doodler, true) : null;
    own?.onChange(() => {
      assign();
      onOwnChange?.();
    });
    ownBox.replaceChildren(...(own ? [own.root] : []));
    ownBtn.textContent = on ? 'Use the shared provider' : 'Use another provider';
    ownBtn.hidden = doodler;
    assign();
  };
  ownBtn.addEventListener('click', () => setOwn(!own));

  testBtn.addEventListener('click', async () => {
    const c = conn().config(modelValue());
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
    if (c.kind === 'fake') return void (status.textContent = 'Works. Fake guessers only pretend to look.');
    try {
      const g = createGuesser(c, { target: () => TEST_WORD, progress: () => 1, difficulty: () => 0 });
      const { guess } = await g.guess({ image: testImage(), wrongGuesses: [], signal: AbortSignal.timeout(30000) });
      status.textContent = testVerdict(guess);
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
    ownBox,
    modelPick,
    customModel,
    fakeNote,
    el('div', { class: 'row slot-foot' }, [testBtn, ownBtn]),
    status,
  ]);
  if (!doodler) root.style.setProperty('--lane', botColor(n - 1));
  setOwn(doodler);
  return {
    root,
    removeBtn,
    read: () => conn().config(modelValue()),
    kind: () => conn().kind(),
    model: modelValue,
    shared: () => !own,
    assign,
    useModel: (id) => {
      if (own) setOwn(false);
      render(id);
    },
    setNumber: (num) => {
      if (doodler) return;
      root.className = `slot card p${(num - 1) % 3}`;
      root.style.setProperty('--lane', botColor(num - 1));
      avatar.replaceChildren(robot(num - 1));
      title.textContent = `Bot #${num}`;
      removeBtn.setAttribute('aria-label', `Remove Bot #${num}`);
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

/**
 * Test shows the model an apple: a model that can't see has no reason to say "apple", so a right
 * answer means it really looked (a circle was too easy to name blind).
 */
const TEST_WORD: Word = { word: 'apple' };

/** What Test says about the model's answer to the apple. */
export function testVerdict(guess: string): string {
  return isMatch(guess, TEST_WORD)
    ? 'Works. It saw the apple 🍎'
    : `It can’t see images: it said “${guess}”, but it was an apple.`;
}

/** A red apple with a stem and a green leaf, outlined in ink, on white. */
function testImage(): string {
  const c = document.createElement('canvas');
  c.width = c.height = 192;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 192, 192);
  ctx.lineWidth = 5;
  ctx.lineJoin = ctx.lineCap = 'round';
  ctx.strokeStyle = '#2b2b2b';
  // The body: two lobes with a dip at the top and a small one at the bottom.
  ctx.beginPath();
  ctx.moveTo(96, 62);
  ctx.bezierCurveTo(70, 40, 26, 52, 30, 100);
  ctx.bezierCurveTo(33, 140, 62, 172, 84, 166);
  ctx.quadraticCurveTo(96, 162, 108, 166);
  ctx.bezierCurveTo(130, 172, 159, 140, 162, 100);
  ctx.bezierCurveTo(166, 52, 122, 40, 96, 62);
  ctx.closePath();
  ctx.fillStyle = '#e5383b';
  ctx.fill();
  ctx.stroke();
  // The stem.
  ctx.beginPath();
  ctx.moveTo(96, 64);
  ctx.quadraticCurveTo(94, 42, 102, 26);
  ctx.strokeStyle = '#6b4226';
  ctx.lineWidth = 6;
  ctx.stroke();
  // The leaf.
  ctx.beginPath();
  ctx.moveTo(100, 40);
  ctx.quadraticCurveTo(122, 18, 146, 30);
  ctx.quadraticCurveTo(124, 52, 100, 40);
  ctx.fillStyle = '#4caf50';
  ctx.fill();
  ctx.strokeStyle = '#2b2b2b';
  ctx.lineWidth = 4;
  ctx.stroke();
  return c.toDataURL('image/jpeg', 0.9);
}
