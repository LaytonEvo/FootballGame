import { describe, expect, it } from 'vitest';
import { revealOrder } from '../src/lib/motion';

describe('pack reveal order', () => {
  it('reveals lowest rarity first and the best card last, keeping squad order within a rarity', () => {
    const cards = [
      { id: 'gk', rarity: 'bronze' as const, rating: 48 },
      { id: 'def', rarity: 'bronze' as const, rating: 53 },
      { id: 'mid', rarity: 'silver' as const, rating: 62 },
      { id: 'mid2', rarity: 'bronze' as const, rating: 53 },
      { id: 'fwd', rarity: 'elite' as const, rating: 85 },
    ];
    expect(revealOrder(cards).map((c) => c.id)).toEqual(['gk', 'def', 'mid2', 'mid', 'fwd']);
  });
});
