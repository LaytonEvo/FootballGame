import type { Position } from '@ff/shared';

/** Legacy mapping from the dataset's price (tenths of £m). Kept for reference; not position-aware. */
export function ratingFromProviderValue(value: number): number {
  return Math.max(40, Math.min(99, Math.round(48 + 0.9 * (value - 40))));
}

export interface RatingInput {
  ref: string;
  position: Position;
  /** Provider quality signal (dev: FPL price). Only compared within a position. */
  quality: number;
  /** A first-team regular (dev: 900+ league minutes). Ratings are ranked among regulars. */
  regular: boolean;
}

/**
 * Card ratings are percentiles within each position, so every position has its own bronze, silver, gold and
 * elite players. Prices alone put every goalkeeper and defender below 67 (the best keeper was silver).
 * Shares among regulars: bronze 50%, silver 28%, gold 15%, elite 7%, matching the rarity bands in
 * config/packs (40-59, 60-71, 72-81, 82-99). Non-regulars are capped in bronze.
 */
const BANDS: { from: number; to: number; lo: number; hi: number }[] = [
  { from: 0, to: 0.5, lo: 45, hi: 59 },
  { from: 0.5, to: 0.78, lo: 60, hi: 71 },
  { from: 0.78, to: 0.93, lo: 72, hi: 81 },
  { from: 0.93, to: 1.0001, lo: 82, hi: 95 },
];

export function ratingForPercentile(p: number): number {
  const b = BANDS.find((x) => p >= x.from && p < x.to) ?? BANDS.at(-1)!;
  const t = Math.min(1, Math.max(0, (p - b.from) / (Math.min(1, b.to) - b.from)));
  return Math.round(b.lo + t * (b.hi - b.lo));
}

export function positionalRatings(players: RatingInput[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const pos of ['GK', 'DEF', 'MID', 'FWD'] as Position[]) {
    const regs = players
      .filter((p) => p.position === pos && p.regular)
      .map((p) => p.quality)
      .sort((a, b) => a - b);
    for (const p of players.filter((x) => x.position === pos)) {
      if (regs.length === 0) {
        out.set(p.ref, 50);
        continue;
      }
      // Mid-rank percentile among regulars (ties share a rating).
      const below = regs.filter((q) => q < p.quality).length;
      const equal = regs.filter((q) => q === p.quality).length;
      const pct =
        regs.length === 1 ? 0.5 : Math.min(1, (below + Math.max(0, equal - 1) / 2) / (regs.length - 1));
      const r = ratingForPercentile(pct);
      out.set(p.ref, p.regular ? r : Math.min(55, r));
    }
  }
  return out;
}
