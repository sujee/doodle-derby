import { describe, expect, it, vi } from 'vitest';
import type { ModelInfo } from '../src/providers';
import { pickModel } from '../src/setup';

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
  /** Setup with Bot #1 on OpenAI and its (mocked) model list loaded. */
  async function loaded() {
    const { renderSetup } = await import('../src/setup');
    const { OPENAI_PRESETS } = await import('../src/providers');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), { status: 200 })));
    HTMLElement.prototype.scrollIntoView ??= () => {}; // jsdom has none; adding bots scrolls to the new card
    const container = document.createElement('div');
    document.body.append(container);
    renderSetup(container, () => {});
    const slots = () => [...container.querySelectorAll<HTMLElement>('.guessers-side .slot:not([hidden])')];
    const first = slots()[0];
    const provider = first.querySelector('select')!;
    provider.value = `openai:${OPENAI_PRESETS.findIndex((p) => p.name === 'OpenAI')}`;
    provider.dispatchEvent(new Event('change'));
    const refresh = first.querySelector<HTMLButtonElement>('.refresh')!;
    expect(refresh).not.toBeNull();
    refresh.click();
    await vi.waitFor(() => expect(first.querySelectorAll('select')[1].value).toBeTruthy());
    const chosen = () => slots().map((s) => [...s.querySelectorAll('select')].find((sel) => !sel.closest('[hidden]') && sel.querySelector('optgroup'))?.value);
    return { container, first, slots, chosen };
  }

  it('gives the new bot (same provider) a model the others don’t use', async () => {
    const { container, chosen } = await loaded();
    const add = container.querySelector<HTMLButtonElement>('.add-bot')!;
    add.click();
    add.click();
    expect(chosen()).toHaveLength(3);
    expect(new Set(chosen()).size).toBe(3);
    expect(chosen().every((c) => ids.includes(c!))).toBe(true);
    container.remove();
    vi.unstubAllGlobals();
  });

  it('"Add all" makes one bot per image model, with no upper limit', async () => {
    const { container, first, chosen } = await loaded();
    const all = first.querySelector<HTMLButtonElement>('.add-all')!;
    expect(all.hidden).toBe(false);
    expect(all.textContent).toContain(`Add all ${ids.length}`);
    all.click();
    expect(chosen()).toHaveLength(ids.length);
    expect(new Set(chosen())).toEqual(new Set(ids));
    expect(container.querySelector<HTMLButtonElement>('.add-bot')!.hidden).toBe(false); // still room for more
    container.remove();
    vi.unstubAllGlobals();
  });
});
