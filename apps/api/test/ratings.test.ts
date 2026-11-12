import { describe, expect, it } from 'vitest';
import { parsePacksConfig, rarityForRating } from '@ff/shared';
import { players } from '../src/db/schema.js';
import { readConfigFile } from '../src/services/config.js';
import { positionalRatings, ratingForPercentile } from '../src/services/ratings.js';
import { datasetCtx } from './fixtures.js';

const packs = parsePacksConfig(readConfigFile('packs.v0.1.json'));

describe('position-relative ratings', () => {
  it('maps percentiles onto the rarity bands', () => {
    expect(rarityForRating(packs, ratingForPercentile(0))).toBe('bronze');
    expect(rarityForRating(packs, ratingForPercentile(0.6))).toBe('silver');
    expect(rarityForRating(packs, ratingForPercentile(0.85))).toBe('gold');
    expect(rarityForRating(packs, ratingForPercentile(1))).toBe('elite');
  });

  it('caps non-regulars in bronze and lets ties share a rating', () => {
    const r = positionalRatings([
      { ref: 'a', position: 'GK', quality: 40, regular: true },
      { ref: 'b', position: 'GK', quality: 50, regular: true },
      { ref: 'c', position: 'GK', quality: 55, regular: true },
      { ref: 'd', position: 'GK', quality: 55, regular: true },
      { ref: 'e', position: 'GK', quality: 60, regular: false },
    ]);
    expect(r.get('c')).toBe(r.get('d'));
    expect(r.get('e')).toBeLessThanOrEqual(55);
  });

  it('on the real data: top keepers and defenders are elite, and every position has all four rarities', async () => {
    const t = await datasetCtx([1], '2027-06-01T00:00:00Z'); // after the season: everyone registered
    const rows = await t.db.select().from(players);
    const byName = (n: string) => rows.find((p) => p.name === n)!;
    expect(rarityForRating(packs, byName('Gianluigi Donnarumma').rating)).toBe('elite');
    expect(rarityForRating(packs, byName('Virgil van Dijk').rating)).not.toBe('bronze');
    expect(rarityForRating(packs, byName('Erling Haaland').rating)).toBe('elite');
    expect(rarityForRating(packs, byName('Jayden Danns').rating)).toBe('bronze');
    for (const pos of ['GK', 'DEF', 'MID', 'FWD'] as const) {
      const rar = new Set(
        rows.filter((p) => p.position === pos).map((p) => rarityForRating(packs, p.rating)),
      );
      expect([...rar].sort()).toEqual(['bronze', 'elite', 'gold', 'silver']);
    }
    await t.close();
  });
});
