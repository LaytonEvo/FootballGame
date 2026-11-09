import type { PlayerMatchStats } from '@ff/shared';

/** A player's statistics for a whole gameweek (double gameweeks combined). */
export interface GameweekStats {
  /** No valid (non-postponed, non-abandoned) match in the gameweek: blank or voided. */
  noValidMatch: boolean;
  /** Had at least one match, but every one was postponed or abandoned. */
  voided: boolean;
  /** Every valid match is finished (true for no valid match). */
  finished: boolean;
  /** Some valid match has not started yet. */
  hasUnstarted: boolean;
  matches: number;
  minutes: number;
  goals: number;
  assists: number;
  cleanSheets: number;
  goalsConceded: number;
  saves: number;
  penaltiesSaved: number;
  yellowCards: number;
  redCards: number;
  tackles: number | undefined;
  cbi: number | undefined;
  defensiveContribution: number | undefined;
  /** Clean sheet can no longer land: every valid match finished without one or is live with a goal conceded. */
  cleanSheetDead: boolean;
}

const sumOpt = (a: number | undefined, b: number | undefined) =>
  a === undefined || b === undefined ? undefined : a + b;

export function aggregate(matches: readonly PlayerMatchStats[], cleanSheetMinMinutes: number): GameweekStats {
  const valid = matches.filter((m) => m.status !== 'postponed' && m.status !== 'abandoned');
  const g: GameweekStats = {
    noValidMatch: valid.length === 0,
    voided: matches.length > 0 && valid.length === 0,
    finished: valid.every((m) => m.status === 'finished'),
    hasUnstarted: valid.some((m) => m.status === 'scheduled'),
    matches: valid.length,
    minutes: 0,
    goals: 0,
    assists: 0,
    cleanSheets: 0,
    goalsConceded: 0,
    saves: 0,
    penaltiesSaved: 0,
    yellowCards: 0,
    redCards: 0,
    tackles: 0,
    cbi: 0,
    defensiveContribution: 0,
    cleanSheetDead: true,
  };
  for (const m of valid) {
    g.minutes += m.minutes;
    g.goals += m.goals;
    g.assists += m.assists;
    // Enforce the minutes rule ourselves rather than trusting the feed flag alone.
    const cs = m.status === 'finished' && m.cleanSheet && m.minutes >= cleanSheetMinMinutes;
    if (cs) g.cleanSheets += 1;
    const stillPossible = m.status === 'scheduled' || (m.status === 'live' && m.goalsConceded === 0);
    if (cs || stillPossible) g.cleanSheetDead = false;
    g.goalsConceded += m.goalsConceded;
    g.saves += m.saves;
    g.penaltiesSaved += m.penaltiesSaved;
    g.yellowCards += m.yellowCards;
    g.redCards += m.redCards;
    g.tackles = sumOpt(g.tackles, m.tackles);
    g.cbi = sumOpt(g.cbi, m.cbi);
    g.defensiveContribution = sumOpt(g.defensiveContribution, m.defensiveContribution);
  }
  if (valid.length === 0) {
    g.tackles = g.cbi = g.defensiveContribution = undefined;
  }
  return g;
}
