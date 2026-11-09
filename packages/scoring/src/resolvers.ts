import type { Position } from '@ff/shared';
import type { GameweekStats } from './aggregate.js';

/**
 * How an action resolves against gameweek stats.
 * `count` > 0 means landed (per-occurrence actions multiply by count).
 * `monotonic` actions can land mid-match: once true they stay true.
 * Returns null when the stat is not supplied by the feed.
 */
export interface Resolver {
  count: (s: GameweekStats, pos: Position) => number | null;
  monotonic: boolean;
  /** Can the action be declared missed before every match is finished? */
  deadEarly?: (s: GameweekStats) => boolean;
}

const b = (x: boolean) => (x ? 1 : 0);
const thr = (v: number | undefined, n: number) => (v === undefined ? null : b(v >= n));

/** FPL defensive-contribution thresholds: DEF 10 CBIT, MID 12 CBIRT. */
export const DEF_CONTRIBUTION_THRESHOLD: Partial<Record<Position, number>> = { DEF: 10, MID: 12 };

export const RESOLVERS: Record<string, Resolver> = {
  goal: { count: (s) => s.goals, monotonic: true },
  goals_2plus: { count: (s) => b(s.goals >= 2), monotonic: true },
  hat_trick: { count: (s) => b(s.goals >= 3), monotonic: true },
  assist: { count: (s) => b(s.assists >= 1), monotonic: true },
  goal_involvement: { count: (s) => b(s.goals + s.assists >= 1), monotonic: true },
  clean_sheet: { count: (s) => b(s.cleanSheets >= 1), monotonic: false, deadEarly: (s) => s.cleanSheetDead },
  saves_3plus: { count: (s) => b(s.saves >= 3), monotonic: true },
  saves_5plus: { count: (s) => b(s.saves >= 5), monotonic: true },
  penalty_save: { count: (s) => b(s.penaltiesSaved >= 1), monotonic: true },
  tackles_3plus: { count: (s) => thr(s.tackles, 3), monotonic: true },
  cbi_5plus: { count: (s) => thr(s.cbi, 5), monotonic: true },
  def_contribution: {
    count: (s, pos) => thr(s.defensiveContribution, DEF_CONTRIBUTION_THRESHOLD[pos] ?? Infinity),
    monotonic: true,
  },
  plays_90: { count: (s) => b(s.minutes >= 90), monotonic: true },
  yellow_card: { count: (s) => b(s.yellowCards >= 1), monotonic: true },
  scores_and_booked: { count: (s) => b(s.goals >= 1 && s.yellowCards >= 1), monotonic: true },
};
