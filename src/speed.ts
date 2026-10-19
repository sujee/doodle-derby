/** How fast a right guess was: up to 5 s, up to 15 s, slower (a round is 30 s). Tints its time in the game and on the share cards. */
export function speedTier(secs: number): 'fast' | 'mid' | 'slow' {
  return secs <= 5 ? 'fast' : secs <= 15 ? 'mid' : 'slow';
}
