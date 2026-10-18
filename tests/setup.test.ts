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
  it('gives the new bot (same provider) a model the others don’t use', async () => {
    const { renderSetup } = await import('../src/setup');
    const { OPENAI_PRESETS } = await import('../src/providers');
    const ids = ['gpt-4o', 'gpt-4.1', 'gpt-4o-mini'];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const container = document.createElement('div');
    document.body.append(container);
    renderSetup(container, () => {});
    const slots = [...container.querySelectorAll<HTMLElement>('.guessers-side .slot')];
    const provider = slots[0].querySelector('select')!;
    provider.value = `openai:${OPENAI_PRESETS.findIndex((p) => p.name === 'OpenAI')}`;
    provider.dispatchEvent(new Event('change'));
    const hint = slots[0].querySelector<HTMLElement>('.load-hint')!;
    expect(hint.hidden).toBe(false); // the arrow points at Load models until the list is in
    [...slots[0].querySelectorAll('button')].find((b) => b.textContent === 'Load models')!.click();
    await vi.waitFor(() => expect(slots[0].querySelectorAll('select')[1].value).toBeTruthy());
    expect(hint.hidden).toBe(true);

    HTMLElement.prototype.scrollIntoView ??= () => {}; // jsdom has none; Add bot scrolls to the new card
    const add = container.querySelector<HTMLButtonElement>('.add-bot')!;
    add.click();
    add.click();
    const chosen = slots.map((s) => [...s.querySelectorAll('select')].find((sel) => !sel.closest('[hidden]') && sel.querySelector('optgroup'))?.value);
    expect(new Set(chosen).size).toBe(3);
    expect(chosen.every((c) => ids.includes(c!))).toBe(true);
    container.remove();
    vi.unstubAllGlobals();
  });
});
