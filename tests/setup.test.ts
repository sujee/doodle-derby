import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelInfo } from '../src/providers';
import { forgetProviders, pickModel, testVerdict } from '../src/setup';

// The setup screen remembers keys and model lists for the tab; each test starts with none.
afterEach(forgetProviders);

const m = (id: string, vision: ModelInfo['vision'] = 'yes') => ({ id, vision }) as ModelInfo;

describe('pickModel (a new bot gets a model nobody else has)', () => {
  const list = [m('a'), m('b'), m('c'), m('text', 'no')];

  it('picks at random among image models not taken', () => {
    expect(pickModel(list, ['a'], () => 0)).toBe('b');
    expect(pickModel(list, ['a'], () => 0.99)).toBe('c');
    expect(pickModel(list, ['a', 'b'], () => 0.5)).toBe('c');
  });

  it('never picks a text-only model while an image one exists, even if all are taken', () => {
    expect(pickModel(list, ['a', 'b', 'c'], () => 0.99)).not.toBe('text');
    expect(pickModel([], [])).toBeUndefined();
  });
});

describe('Add bot on the setup screen', () => {
  const ids = ['gpt-4o', 'gpt-4.1', 'gpt-4o-mini', 'gpt-5', 'gpt-5-mini'];
  /** Setup with the shared provider on OpenAI and its (mocked) model list loaded. */
  async function loaded(models: string[] = ids) {
    const { renderSetup } = await import('../src/setup');
    const { OPENAI_PRESETS } = await import('../src/providers');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: models.map((id) => ({ id })) }), { status: 200 })));
    HTMLElement.prototype.scrollIntoView ??= () => {}; // jsdom has none; adding bots scrolls to the new card
    const container = document.createElement('div');
    document.body.append(container);
    renderSetup(container, () => {});
    const conn = container.querySelector<HTMLElement>('.conn.card')!;
    const provider = conn.querySelector('select')!;
    provider.value = `openai:${OPENAI_PRESETS.findIndex((p) => p.name === 'OpenAI')}`;
    provider.dispatchEvent(new Event('change'));
    conn.querySelector<HTMLButtonElement>('.refresh')!.click();
    const slots = () => [...container.querySelectorAll<HTMLElement>('.guessers-side .slot:not([hidden])')];
    await vi.waitFor(() => expect(slots()[0].querySelector<HTMLSelectElement>('.model-pick select')!.value).toBeTruthy());
    const chosen = () => slots().map((s) => s.querySelector<HTMLSelectElement>('.model-pick select')!.value);
    const done = () => {
      container.remove();
      vi.unstubAllGlobals();
    };
    return { container, conn, slots, chosen, done };
  }

  it('sets the provider once, above the cards: the cards only pick a model', async () => {
    const { slots, done } = await loaded();
    const card = slots()[0];
    expect(card.querySelector('input[type=password]')).toBeNull(); // no key box on the card
    expect(card.querySelector('.model-name')!.textContent).toBeTruthy(); // the whole model name shows
    done();
  });

  it('gives the new bot (same provider) a model the others don’t use', async () => {
    const { container, chosen, done } = await loaded();
    const add = container.querySelector<HTMLButtonElement>('.add-bot')!;
    add.click();
    add.click();
    expect(chosen()).toHaveLength(3);
    expect(new Set(chosen()).size).toBe(3);
    expect(chosen().every((c) => ids.includes(c))).toBe(true);
    done();
  });

  it('never doubles up a model the image filter hides (it used to fall back to Bot #1’s)', async () => {
    // "foo-*" models have unknown image support, so the filter hides them; only the gpt-4o ones show.
    const mixed = ['gpt-4o', 'gpt-4o-mini', 'foo-1', 'foo-2', 'foo-3', 'foo-4'];
    const { container, chosen, done } = await loaded(mixed);
    const add = container.querySelector<HTMLButtonElement>('.add-bot')!;
    add.click();
    expect(new Set(chosen()).size).toBe(2);
    done();
  });

  it('"Add all" makes one bot per image model, with no upper limit', async () => {
    const { container, conn, chosen, done } = await loaded();
    const all = conn.querySelector<HTMLButtonElement>('.add-all')!;
    expect(all.hidden).toBe(false);
    expect(all.textContent).toContain(`Add all ${ids.length}`);
    all.click();
    expect(chosen()).toHaveLength(ids.length);
    expect(new Set(chosen())).toEqual(new Set(ids));
    expect(container.querySelector<HTMLButtonElement>('.add-bot')!.hidden).toBe(false); // still room for more
    done();
  });

  it('a bot can switch to its own provider, and back', async () => {
    const { slots, done } = await loaded();
    const card = slots()[0];
    card.querySelector<HTMLButtonElement>('.slot-foot .link-btn')!.click();
    expect(card.querySelector('.own-conn .conn')).not.toBeNull();
    expect(card.querySelector<HTMLElement>('.model-pick')!.hidden).toBe(true); // its own provider starts as Fake
    card.querySelector<HTMLButtonElement>('.slot-foot .link-btn')!.click();
    expect(card.querySelector('.own-conn .conn')).toBeNull();
    expect(card.querySelector<HTMLSelectElement>('.model-pick select')!.value).toBeTruthy();
    done();
  });

  it('the ✕ removes any bot, and the rest renumber', async () => {
    const { container, slots, done } = await loaded();
    const add = container.querySelector<HTMLButtonElement>('.add-bot')!;
    add.click();
    add.click(); // three bots, Bot #1..#3
    expect(slots().map((s) => s.querySelector('h2')!.textContent)).toEqual(['Bot #1', 'Bot #2', 'Bot #3']);

    slots()[0].querySelector<HTMLButtonElement>('.remove')!.click(); // remove Bot #1
    expect(slots().map((s) => s.querySelector('h2')!.textContent)).toEqual(['Bot #1', 'Bot #2']);

    slots()[1].querySelector<HTMLButtonElement>('.remove')!.click(); // remove the last one too
    expect(slots()).toHaveLength(1);
    expect(slots()[0].querySelector<HTMLButtonElement>('.remove')!.hidden).toBe(true); // the last bot can't go
    done();
  });
});

describe('Test shows an apple, and grades the answer', () => {
  it('passes a model that names the apple, however it puts it', () => {
    for (const g of ['apple', 'An apple.', 'red apple', 'Apples']) expect(testVerdict(g)).toContain('saw the apple');
  });

  it('flags a model that names something else: it can’t see', () => {
    expect(testVerdict('circle')).toBe('It can’t see images: it said “circle”, but it was an apple.');
    expect(testVerdict('pineapple')).toContain('can’t see'); // not "apple" at the end of a word
  });
});

describe('the setup screen’s Play, keys note and model labels', () => {
  const fresh = async (onStart = vi.fn()) => {
    const { renderSetup } = await import('../src/setup');
    const { OPENAI_PRESETS } = await import('../src/providers');
    HTMLElement.prototype.scrollIntoView ??= () => {};
    const container = document.createElement('div');
    document.body.append(container);
    renderSetup(container, onStart);
    const provider = container.querySelector<HTMLSelectElement>('.conn select')!;
    const use = (name: string) => {
      provider.value = `openai:${OPENAI_PRESETS.findIndex((p) => p.name === name)}`;
      provider.dispatchEvent(new Event('change'));
    };
    return { container, use, onStart, error: () => container.querySelector('.error')!.textContent, play: () => container.querySelector<HTMLButtonElement>('.start')!.click() };
  };

  it('starts at once with the Fake guesser (no key, no model)', async () => {
    const { container, onStart, play, error } = await fresh();
    play();
    expect(onStart).toHaveBeenCalledWith([{ kind: 'fake' }], null);
    expect(error()).toBe('');
    container.remove();
  });

  it('asks for a model before it starts with a real provider that has none yet', async () => {
    const { container, use, onStart, play, error } = await fresh();
    use('OpenAI');
    play();
    expect(onStart).not.toHaveBeenCalled();
    expect(error()).toBe('Pick a model for each Doodlebot first.');
    container.remove();
  });

  it('says the keys stay in the tab only once a real provider is picked', async () => {
    const { container, use } = await fresh();
    const note = container.querySelector<HTMLElement>('.setup > .note')!;
    expect(note.hidden).toBe(true); // nothing to protect with the Fake guesser
    use('OpenAI');
    expect(note.hidden).toBe(false);
    container.remove();
  });

  it('loads the model list by itself a moment after a key is typed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'some-model' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { container, use } = await fresh();
    use('OpenAI');
    fetchMock.mockClear();
    const key = container.querySelector<HTMLInputElement>('.conn input[type=password]')!;
    key.value = 'sk-test';
    key.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(300);
    expect(fetchMock).not.toHaveBeenCalled(); // still waiting for the typing to stop
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.conn .status')!.textContent).toContain('1 models');
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('labels a model whose image support is unknown, with a hint to Test it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'zz-unheard-of-7b' }] }), { status: 200 })));
    const { container, use } = await fresh();
    use('OpenAI');
    container.querySelector<HTMLButtonElement>('.conn .refresh')!.click();
    await vi.waitFor(() => expect(container.querySelector('.conn .status')!.textContent).toContain('1 models'));
    container.querySelector<HTMLInputElement>('.conn input[type=checkbox]')!.click(); // show models that may not take images too
    const label = container.querySelector<HTMLElement>('.slot .model-vis')!;
    expect(label.dataset.vision).toBe('unknown');
    expect(label.textContent).toContain('Test it');
    expect(label.title).toContain('use Test');
    container.remove();
    vi.unstubAllGlobals();
  });
});

describe('a provider’s key and models are asked for once per tab', () => {
  const ids = ['gpt-4o', 'gpt-4.1'];
  async function setup() {
    const { renderSetup } = await import('../src/setup');
    const { OPENAI_PRESETS } = await import('../src/providers');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    HTMLElement.prototype.scrollIntoView ??= () => {};
    const container = document.createElement('div');
    document.body.append(container);
    const openai = `openai:${OPENAI_PRESETS.findIndex((p) => p.name === 'OpenAI')}`;
    const pick = (conn: HTMLElement) => {
      const provider = conn.querySelector('select')!;
      provider.value = openai;
      provider.dispatchEvent(new Event('change'));
    };
    const render = () => renderSetup(container, () => {});
    const shared = () => container.querySelector<HTMLElement>('.conn.card')!;
    const keyBox = (conn: HTMLElement) => conn.querySelector<HTMLInputElement>('input[type=password]')!.closest<HTMLElement>('.field')!;
    const keySet = (conn: HTMLElement) => conn.querySelector<HTMLElement>('.key-set')!;
    const firstModel = () => container.querySelector<HTMLSelectElement>('.guessers-side .slot .model-pick select')!.value;
    const done = () => {
      container.remove();
      vi.unstubAllGlobals();
    };
    // Set the shared provider up once: pick OpenAI, type a key, load the list.
    render();
    pick(shared());
    const key = shared().querySelector<HTMLInputElement>('input[type=password]')!;
    key.value = 'sk-test';
    shared().querySelector<HTMLButtonElement>('.refresh')!.click();
    await vi.waitFor(() => expect(firstModel()).toBeTruthy());
    return { container, fetchMock, render, pick, shared, keyBox, keySet, firstModel, done };
  }

  it('shows "Key set" instead of the key box once the key worked', async () => {
    const { shared, keyBox, keySet, done } = await setup();
    expect(keyBox(shared()).hidden).toBe(true);
    expect(keySet(shared()).hidden).toBe(false);
    keySet(shared()).querySelector('button')!.click(); // Change brings the box back, key still in it
    expect(keyBox(shared()).hidden).toBe(false);
    expect(shared().querySelector<HTMLInputElement>('input[type=password]')!.value).toBe('sk-test');
    done();
  });

  it('back on the setup screen, keeps the provider and its models without loading again', async () => {
    const { fetchMock, render, shared, keyBox, firstModel, done } = await setup();
    fetchMock.mockClear();
    render(); // "Change bots"
    expect(keyBox(shared()).hidden).toBe(true);
    expect(ids).toContain(firstModel());
    expect(shared().querySelector('.status')!.textContent).toContain(`${ids.length} models`);
    expect(fetchMock).not.toHaveBeenCalled();
    done();
  });

  it('a bot switched to its own provider reuses that provider’s key and models', async () => {
    const { container, fetchMock, pick, keyBox, keySet, done } = await setup();
    container.querySelector<HTMLButtonElement>('.add-bot')!.click();
    fetchMock.mockClear();
    const card = [...container.querySelectorAll<HTMLElement>('.guessers-side .slot')][1];
    card.querySelector<HTMLButtonElement>('.slot-foot .link-btn')!.click(); // Use another provider
    const own = card.querySelector<HTMLElement>('.own-conn .conn')!;
    pick(own);
    expect(keyBox(own).hidden).toBe(true);
    expect(keySet(own).hidden).toBe(false);
    expect(ids).toContain(card.querySelector<HTMLSelectElement>('.model-pick select')!.value);
    expect(fetchMock).not.toHaveBeenCalled();
    done();
  });
});
