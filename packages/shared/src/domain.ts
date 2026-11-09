export const POSITIONS = ['GK', 'DEF', 'MID', 'FWD'] as const;
export type Position = (typeof POSITIONS)[number];

export const RARITIES = ['bronze', 'silver', 'gold', 'elite'] as const;
export type Rarity = (typeof RARITIES)[number];

export const TIERS = ['likely', 'possible', 'bold', 'long_shot', 'chaos'] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_LABEL: Record<Tier, string> = {
  likely: 'Likely',
  possible: 'Possible',
  bold: 'Bold',
  long_shot: 'Long shot',
  chaos: 'Chaos',
};

/** Fixed squad shape: starters in slot order, then one substitute of any position. */
export const STARTER_SHAPE: readonly Position[] = ['GK', 'DEF', 'MID', 'MID', 'FWD'];
export const MAX_PLAYERS_PER_CLUB = 2;

export const DISCLAIMER = 'Not affiliated with or endorsed by the Premier League, any club or any player.';

export type MatchStatus = 'scheduled' | 'live' | 'finished' | 'postponed' | 'abandoned';

/**
 * One player's statistics in one match. Counting stats for the basic feed are required;
 * advanced-feed stats are optional (absent = not supplied by the feed).
 */
export interface PlayerMatchStats {
  playerId: string;
  fixtureId: string;
  status: MatchStatus;
  minutes: number;
  goals: number;
  assists: number;
  /** Provider's clean-sheet flag: 60+ minutes on the pitch and no goal conceded while on it. */
  cleanSheet: boolean;
  goalsConceded: number;
  saves: number;
  penaltiesSaved: number;
  yellowCards: number;
  redCards: number;
  tackles?: number;
  cbi?: number;
  defensiveContribution?: number;
}
