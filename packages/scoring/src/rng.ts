/** Small seeded PRNG (mulberry32) so simulations and pack draws are reproducible from a logged seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derive a 32-bit seed from a string (FNV-1a), e.g. `${userId}:${packId}`. */
export function seedFromString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const randInt = (rand: () => number, n: number) => Math.floor(rand() * n);
export function pickOne<T>(rand: () => number, xs: readonly T[]): T {
  if (xs.length === 0) throw new Error('pickOne on empty list');
  return xs[randInt(rand, xs.length)]!;
}
export function shuffle<T>(rand: () => number, xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(rand, i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
