export type Word = { word: string; alts?: string[] };
export type Tier = 'easy' | 'medium' | 'hard';

export const WORDS: Record<Tier, Word[]> = {
  easy: [
    { word: 'ball' },
    { word: 'hat', alts: ['cap'] },
    { word: 'sun' },
    { word: 'tree' },
    { word: 'house', alts: ['home', 'hut'] },
    { word: 'fish' },
    { word: 'cat', alts: ['kitten', 'kitty'] },
    { word: 'apple' },
    { word: 'star' },
    { word: 'moon', alts: ['crescent'] },
    { word: 'heart' },
    { word: 'flower', alts: ['daisy', 'tulip'] },
    { word: 'cup', alts: ['mug'] },
    { word: 'car', alts: ['automobile'] },
    { word: 'smiley face', alts: ['smiley', 'face', 'smile'] },
    { word: 'cloud' },
    { word: 'banana' },
    { word: 'egg' },
    { word: 'door' },
    { word: 'key' },
    { word: 'eye' },
    { word: 'snowman' },
  ],
  medium: [
    { word: 'bicycle', alts: ['bike'] },
    { word: 'umbrella' },
    { word: 'guitar' },
    { word: 'bird' },
    { word: 'airplane', alts: ['plane', 'aeroplane', 'jet'] },
    { word: 'clock', alts: ['watch'] },
    { word: 'glasses', alts: ['eyeglasses', 'spectacles', 'sunglasses'] },
    { word: 'rocket', alts: ['spaceship'] },
    { word: 'scissors' },
    { word: 'ice cream', alts: ['ice cream cone', 'cone'] },
    { word: 'boat', alts: ['ship', 'sailboat'] },
    { word: 'snake' },
    { word: 'mushroom' },
    { word: 'pizza', alts: ['pizza slice'] },
    { word: 'candle' },
    { word: 'butterfly' },
    { word: 'spider' },
    { word: 'light bulb', alts: ['lightbulb', 'bulb', 'lamp'] },
    { word: 'turtle', alts: ['tortoise'] },
    { word: 'crown' },
    { word: 'tent' },
    { word: 'anchor' },
  ],
  hard: [
    { word: 'lighthouse' },
    { word: 'octopus' },
    { word: 'helicopter' },
    { word: 'giraffe' },
    { word: 'castle' },
    { word: 'elephant' },
    { word: 'kangaroo' },
    { word: 'windmill' },
    { word: 'telescope' },
    { word: 'dragon' },
    { word: 'camel' },
    { word: 'saxophone', alts: ['sax'] },
    { word: 'penguin' },
    { word: 'skateboard' },
    { word: 'volcano' },
    { word: 'microscope' },
    { word: 'hourglass', alts: ['sand timer'] },
    { word: 'roller coaster', alts: ['rollercoaster'] },
    { word: 'parachute' },
    { word: 'hot air balloon', alts: ['balloon'] },
  ],
};

export const ROUNDS = 10;

export function tierForRound(round: number): Tier {
  if (round < 3) return 'easy';
  if (round < 7) return 'medium';
  return 'hard';
}

/** Pick ROUNDS distinct words, easy first, getting harder. */
export function pickWords(): Word[] {
  const pools: Record<Tier, Word[]> = {
    easy: shuffle([...WORDS.easy]),
    medium: shuffle([...WORDS.medium]),
    hard: shuffle([...WORDS.hard]),
  };
  return Array.from({ length: ROUNDS }, (_, i) => pools[tierForRound(i)].pop()!);
}

export const ALL_WORDS: string[] = Object.values(WORDS).flat().map((w) => w.word);

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
