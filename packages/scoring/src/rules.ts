import type { ActionDef, Position, Rarity, ScoringConfig, Tier } from '@ff/shared';
import { boldPenaltyFraction } from '@ff/shared';
import { RESOLVERS } from './resolvers.js';

export interface ActionForPosition {
  id: string;
  label: string;
  overlapGroup: string;
  chaos: boolean;
  feed: 'basic' | 'advanced';
  perOccurrence: boolean;
  points: number;
  hitRate: number;
  tier: Tier;
  /** Expected points per pick at gold rarity, from the config hit rate. */
  expected: number;
}

/** Compiled, lookup-friendly view of a scoring config. Pure data, no I/O. */
export interface RuleSet {
  version: string;
  season: string;
  minActions: number;
  maxActions: number;
  noOverlap: boolean;
  captainMultiplier: number;
  boldPerGameweek: number;
  boldMultiplier: number;
  boldPenaltyFraction: number;
  maxChaos: number;
  rarityMultiplier: Record<Rarity, number>;
  cleanSheetMinMinutes: number;
  /** Sub replaces a starter who played under this many minutes and landed nothing (0 = off). */
  subCameoMinutes: number;
  /** Captaincy passes to the sub when the sub replaces the captain. */
  captainToSub: boolean;
  basicFeedOnly: boolean;
  actions: Map<string, ActionDef>;
  byPosition: Record<Position, Map<string, ActionForPosition>>;
}

export function compileRules(cfg: ScoringConfig): RuleSet {
  const byPosition: RuleSet['byPosition'] = { GK: new Map(), DEF: new Map(), MID: new Map(), FWD: new Map() };
  const actions = new Map<string, ActionDef>();
  for (const a of cfg.actions) {
    if (!RESOLVERS[a.id]) throw new Error(`No resolver implemented for action "${a.id}"`);
    actions.set(a.id, a);
    for (const [pos, p] of Object.entries(a.positions) as [
      Position,
      NonNullable<ActionDef['positions'][Position]>,
    ][]) {
      byPosition[pos].set(a.id, {
        id: a.id,
        label: a.label,
        overlapGroup: a.overlap_group,
        chaos: a.chaos,
        feed: a.data_feed,
        perOccurrence: a.resolution === 'per_occurrence',
        points: p.points,
        hitRate: p.hit_rate_2025_26,
        tier: p.tier,
        expected: p.points * p.hit_rate_2025_26,
      });
    }
  }
  return {
    version: cfg.version,
    season: cfg.season,
    minActions: cfg.rules.actions_per_starter.min,
    maxActions: cfg.rules.actions_per_starter.max,
    noOverlap: cfg.rules.no_two_actions_from_same_overlap_group,
    captainMultiplier: cfg.rules.captain_multiplier,
    boldPerGameweek: cfg.rules.bold_action.per_gameweek,
    boldMultiplier: cfg.rules.bold_action.multiplier_if_landed,
    boldPenaltyFraction: boldPenaltyFraction(cfg),
    maxChaos: cfg.rules.max_chaos_actions_per_squad,
    rarityMultiplier: cfg.rules.rarity_multiplier as Record<Rarity, number>,
    cleanSheetMinMinutes: cfg.rules.clean_sheet_min_minutes,
    subCameoMinutes: cfg.rules.sub_cameo_minutes ?? 0,
    captainToSub: cfg.rules.captain_passes_to_sub ?? false,
    basicFeedOnly: cfg.mvp_basic_feed_only,
    actions,
    byPosition,
  };
}

/** Actions a player in this position may pick under the active feed. */
export function availableActions(rules: RuleSet, position: Position): ActionForPosition[] {
  return [...rules.byPosition[position].values()].filter((a) => !rules.basicFeedOnly || a.feed === 'basic');
}
