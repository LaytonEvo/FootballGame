import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { PlayerMatchStats, Position } from '@ff/shared';
import { parseCsv } from './csv.js';

export { parseCsv };

export const DEFAULT_DATA_DIR = new URL('../../../data/fpl-2025-26/', import.meta.url).pathname;

export interface DsTeam {
  id: number;
  name: string;
  code: string;
}
export interface DsFixture {
  id: number;
  gameweek: number | null;
  kickoff: string | null;
  homeTeamId: number;
  awayTeamId: number;
  homeScore: number | null;
  awayScore: number | null;
  finished: boolean;
}
/** One player in one fixture, with the club they played for at the time. */
export interface DsPlayerMatch {
  playerId: number;
  name: string;
  position: Position;
  teamId: number;
  gameweek: number;
  fixtureId: number;
  kickoff: string;
  wasHome: boolean;
  opponentTeamId: number;
  starts: number;
  /** FPL price in tenths of £m — used only as a rating proxy in development. */
  value: number;
  totalPoints: number;
  stats: PlayerMatchStats;
}

export interface Dataset {
  season: '2025-26';
  teams: DsTeam[];
  fixtures: DsFixture[];
  playerMatches: DsPlayerMatch[];
}

const read = (dir: string, f: string) => parseCsv(gunzipSync(readFileSync(dir + f)).toString('utf8'));
const num = (s: string | undefined) => (s === undefined || s === '' ? 0 : Number(s));
const numOrNull = (s: string | undefined) => (s === undefined || s === '' ? null : Number(s));

let cache: Dataset | null = null;

/** Load the committed 2025/26 snapshot. Development and replay only. */
export function loadDataset(dir = DEFAULT_DATA_DIR): Dataset {
  if (cache && dir === DEFAULT_DATA_DIR) return cache;
  const teams: DsTeam[] = read(dir, 'teams.csv.gz').map((r) => ({
    id: num(r.id),
    name: r.name!,
    code: r.short_name!,
  }));
  const teamByName = new Map(teams.map((t) => [t.name, t]));
  const fixtures: DsFixture[] = read(dir, 'fixtures.csv.gz').map((r) => ({
    id: num(r.id),
    gameweek: numOrNull(r.event),
    kickoff: r.kickoff_time || null,
    homeTeamId: num(r.team_h),
    awayTeamId: num(r.team_a),
    homeScore: numOrNull(r.team_h_score),
    awayScore: numOrNull(r.team_a_score),
    finished: r.finished === 'True',
  }));
  const playerMatches: DsPlayerMatch[] = read(dir, 'player_gw.csv.gz').map((r) => {
    const team = teamByName.get(r.team!);
    if (!team) throw new Error(`Unknown team ${r.team}`);
    const playerId = num(r.element);
    const fixtureId = num(r.fixture);
    return {
      playerId,
      name: r.name!,
      position: r.position as Position,
      teamId: team.id,
      gameweek: num(r.GW),
      fixtureId,
      kickoff: r.kickoff_time!,
      wasHome: r.was_home === 'True',
      opponentTeamId: num(r.opponent_team),
      starts: num(r.starts),
      value: num(r.value),
      totalPoints: num(r.total_points),
      stats: {
        playerId: String(playerId),
        fixtureId: String(fixtureId),
        status: 'finished',
        minutes: num(r.minutes),
        goals: num(r.goals_scored),
        assists: num(r.assists),
        cleanSheet: num(r.clean_sheets) >= 1,
        goalsConceded: num(r.goals_conceded),
        saves: num(r.saves),
        penaltiesSaved: num(r.penalties_saved),
        yellowCards: num(r.yellow_cards),
        redCards: num(r.red_cards),
        tackles: num(r.tackles),
        cbi: num(r.clearances_blocks_interceptions),
        defensiveContribution: num(r.defensive_contribution),
      },
    };
  });
  const ds: Dataset = { season: '2025-26', teams, fixtures, playerMatches };
  if (dir === DEFAULT_DATA_DIR) cache = ds;
  return ds;
}

/** Strip advanced-feed stats, as the basic commercial feed would deliver them. */
export function basicFeedOnly(s: PlayerMatchStats): PlayerMatchStats {
  const { tackles: _t, cbi: _c, defensiveContribution: _d, ...rest } = s;
  return rest;
}
