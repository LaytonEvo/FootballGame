import { z } from 'zod';
import { POSITIONS, RARITIES, TIERS } from './domain.js';

const positionRule = z.object({
  points: z.number().int().positive(),
  hit_rate_2025_26: z.number().min(0).max(1),
  tier: z.enum(TIERS),
});

export const actionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  overlap_group: z.string().min(1),
  chaos: z.boolean(),
  data_feed: z.enum(['basic', 'advanced']),
  resolution: z.enum(['per_occurrence', 'threshold']),
  positions: z.partialRecord(z.enum(POSITIONS), positionRule),
});

export const scoringConfigSchema = z.object({
  version: z.string(),
  season: z.string(),
  status: z.string().optional(),
  rules: z.object({
    actions_per_starter: z.object({ min: z.number().int().min(0), max: z.number().int().min(1) }),
    no_two_actions_from_same_overlap_group: z.boolean(),
    captain_multiplier: z.number().positive(),
    bold_action: z.object({
      per_gameweek: z.number().int().min(0),
      multiplier_if_landed: z.number().positive(),
      penalty_if_missed: z.string(),
    }),
    max_chaos_actions_per_squad: z.number().int().min(0),
    rarity_multiplier: z.record(z.enum(RARITIES), z.number().positive()),
    order_of_operations: z.string(),
    points_fixed_for_season: z.boolean(),
    deadline: z.string(),
    finalisation: z.string(),
    clean_sheet_min_minutes: z.number().int().min(0),
    double_gameweek: z.string(),
    zero_minutes: z.string(),
  }),
  tiers: z.record(z.string(), z.string()),
  removed: z.array(z.string()).default([]),
  parked: z.array(z.string()).default([]),
  mvp_basic_feed_only: z.boolean(),
  actions: z.array(actionSchema).min(1),
});

export type ScoringConfig = z.infer<typeof scoringConfigSchema>;
export type ActionDef = z.infer<typeof actionSchema>;

export const packRewardSchema = z.enum([
  'player_pack',
  'silver_pack',
  'gold_pack',
  'elite_pack',
  'squad_pack',
]);
export type PackReward = z.infer<typeof packRewardSchema>;

export const economyConfigSchema = z.object({
  version: z.string(),
  status: z.string().optional(),
  currencies: z.record(z.string(), z.string()),
  prices_coins: z.object({
    player_pack: z.number().int().positive(),
    card_swap: z.number().int().positive(),
    squad_pack: z.number().int().positive(),
  }),
  free_rewards: z.record(z.string(), z.string()),
  season_milestones: z.array(
    z.object({ season_points: z.number().int().positive(), reward: packRewardSchema }),
  ),
  compensation: z.record(z.string(), z.string()),
  pack_odds: z.unknown(),
  never: z.array(z.string()),
});

export type EconomyConfig = z.infer<typeof economyConfigSchema>;

/** Parse the bold-miss penalty ("-50% of base points, rounded up") into a fraction. */
export function boldPenaltyFraction(cfg: ScoringConfig): number {
  const m = /-?\s*(\d+(?:\.\d+)?)\s*%/.exec(cfg.rules.bold_action.penalty_if_missed);
  if (!m?.[1]) throw new Error(`Unparseable bold penalty: ${cfg.rules.bold_action.penalty_if_missed}`);
  return Number(m[1]) / 100;
}

export function parseScoringConfig(raw: unknown): ScoringConfig {
  const cfg = scoringConfigSchema.parse(raw);
  const ids = new Set<string>();
  for (const a of cfg.actions) {
    if (ids.has(a.id)) throw new Error(`Duplicate action id ${a.id}`);
    ids.add(a.id);
    if (a.chaos !== Object.values(a.positions).every((p) => p?.tier === 'chaos')) {
      throw new Error(`Action ${a.id}: chaos flag and tier disagree`);
    }
  }
  boldPenaltyFraction(cfg);
  return cfg;
}

export function parseEconomyConfig(raw: unknown): EconomyConfig {
  const cfg = economyConfigSchema.parse(raw);
  const pts = cfg.season_milestones.map((m) => m.season_points);
  if (pts.some((p, i) => i > 0 && p <= pts[i - 1]!))
    throw new Error('Milestones must be strictly increasing');
  return cfg;
}

const rarityOdds = z.partialRecord(z.enum(RARITIES), z.number().min(0).max(1));

export const packsConfigSchema = z.object({
  version: z.string(),
  status: z.string().optional(),
  rating: z.object({
    comment: z.string().optional(),
    rarity_bands: z.record(z.enum(RARITIES), z.tuple([z.number().int(), z.number().int()])),
  }),
  squad_rating_cap: z.number().int().positive(),
  odds: z.object({
    player: rarityOdds,
    silver: rarityOdds,
    gold: rarityOdds,
    elite: rarityOdds,
    squad: rarityOdds,
  }),
  starter: z.object({
    comment: z.string().optional(),
    base_tier: z.enum(RARITIES),
    stronger_tier: z.enum(RARITIES),
  }),
  swap: z.record(z.string(), z.string()).optional(),
});
export type PacksConfig = z.infer<typeof packsConfigSchema>;

export function parsePacksConfig(raw: unknown): PacksConfig {
  const cfg = packsConfigSchema.parse(raw);
  for (const [k, odds] of Object.entries(cfg.odds)) {
    const sum = Object.values(odds).reduce((s, x) => s + (x ?? 0), 0);
    if (Math.abs(sum - 1) > 1e-9) throw new Error(`Pack odds for ${k} sum to ${sum}, not 1`);
  }
  return cfg;
}

export function rarityForRating(cfg: PacksConfig, rating: number) {
  for (const r of RARITIES) {
    const [lo, hi] = cfg.rating.rarity_bands[r];
    if (rating >= lo && rating <= hi) return r;
  }
  throw new Error(`Rating ${rating} outside every rarity band`);
}
