import type { Word } from './words';

const ARTICLES = new Set(['a', 'an', 'the', 'some']);

/** Lowercase, strip punctuation and articles, singularize each word. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z\s-]/g, ' ')
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !ARTICLES.has(t))
    .map(singular)
    .join(' ');
}

function singular(t: string): string {
  if (t.length <= 3 || t.endsWith('ss') || t === 'glasses' || t === 'scissors') return t;
  if (t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (/(ches|shes|xes|sses)$/.test(t)) return t.slice(0, -2);
  if (t.endsWith('s')) return t.slice(0, -1);
  return t;
}

export function isMatch(guess: string, target: Word): boolean {
  const g = normalize(guess);
  if (!g) return false;
  // Exact, or the answer as the final word(s): "red ball" and "top hat" count, "basketball" does not.
  return [target.word, ...(target.alts ?? [])].some((w) => {
    const n = normalize(w);
    return g === n || g.endsWith(` ${n}`);
  });
}
