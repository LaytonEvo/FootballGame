import { parseCsv } from '@ff/fpl-dataset';
import type { Position } from '@ff/shared';
import type { Clock } from '../clock.js';
import { MINUTE } from '../clock.js';
import type {
  DataProvider,
  ProviderClub,
  ProviderFixture,
  ProviderMove,
  ProviderPlayer,
  ProviderStat,
} from './types.js';

/**
 * The current season (2026/27) from the public vaastav/Fantasy-Premier-League dataset on GitHub, read at
 * runtime. Closed-test stand-in until the commercial feed: correct clubs, squads, fixtures and injury news,
 * but stats arrive only when the volunteer-maintained files are updated (no live in-play data). Never calls
 * fantasy.premierleague.com.
 */
export const DEFAULT_SEASON_BASE =
  'https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data/2026-27';
const CACHE_MS = 15 * MINUTE;
const POSITION: Record<string, Position> = { '1': 'GK', '2': 'DEF', '3': 'MID', '4': 'FWD' };
const AVAILABILITY: Record<string, ProviderPlayer['availability']> = {
  i: 'injured',
  d: 'doubtful',
  s: 'suspended',
};

type Row = Record<string, string>;
export type FetchText = (url: string) => Promise<string>;

const defaultFetch: FetchText = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Dataset fetch failed: ${url} → ${res.status}`);
  return res.text();
};
const num = (s: string | undefined) => (s === undefined || s === '' ? 0 : Number(s));

export class FplSeasonProvider implements DataProvider {
  readonly name = 'fpl-season';
  readonly squadsAreAuthoritative = true;
  private cache = new Map<string, { at: number; rows: Row[] }>();

  constructor(
    private clock: Clock,
    private base = process.env.FPL_DATASET_BASE ?? DEFAULT_SEASON_BASE,
    private fetchText: FetchText = defaultFetch,
  ) {}

  private async file(name: string): Promise<Row[]> {
    const now = this.clock.now().getTime();
    const hit = this.cache.get(name);
    if (hit && now - hit.at < CACHE_MS) return hit.rows;
    const rows = parseCsv(await this.fetchText(`${this.base}/${name}`));
    this.cache.set(name, { at: now, rows });
    return rows;
  }

  async clubs(): Promise<ProviderClub[]> {
    return (await this.file('teams.csv')).map((t) => ({
      ref: `fpl27:t${t.id}`,
      code: t.short_name!,
      name: t.name!,
    }));
  }

  async squads(): Promise<ProviderPlayer[]> {
    const [players, fixtures] = await Promise.all([this.file('players_raw.csv'), this.file('fixtures.csv')]);
    const played = new Set(fixtures.filter((f) => f.finished === 'True').map((f) => f.event)).size;
    // Regular: 35% of the possible league minutes so far (at least one full match).
    const regularMins = Math.max(90, played * 90 * 0.35);
    // Expensive players count as first-teamers even if injured so far (top quarter of prices per position).
    const p75 = new Map<string, number>();
    for (const t of Object.keys(POSITION)) {
      const costs = players
        .filter((p) => p.element_type === t)
        .map((p) => num(p.now_cost))
        .sort((a, b) => a - b);
      p75.set(t, costs[Math.floor(costs.length * 0.75)] ?? Infinity);
    }
    return players
      .filter((p) => POSITION[p.element_type!])
      .map((p) => {
        const left = p.status === 'u' && p.can_select === 'False';
        return {
          ref: `fpl27:p${p.id}`,
          name: `${p.first_name} ${p.second_name}`.trim(),
          position: POSITION[p.element_type!]!,
          clubRef: left ? null : `fpl27:t${p.team}`,
          shirtNumber: null,
          // Price first; season points break price ties.
          rating: num(p.now_cost) + num(p.total_points) / 1000,
          regular: num(p.minutes) >= regularMins || num(p.now_cost) >= (p75.get(p.element_type!) ?? Infinity),
          status: left ? ('left_league' as const) : ('active' as const),
          availability: AVAILABILITY[p.status ?? ''] ?? null,
          news: p.news ? p.news : null,
        };
      });
  }

  async fixtures(): Promise<ProviderFixture[]> {
    const now = this.clock.now().getTime();
    return (await this.file('fixtures.csv')).map((f) => {
      const kickoffAt = f.kickoff_time ? new Date(f.kickoff_time) : null;
      const finished = f.finished === 'True';
      const status: ProviderFixture['status'] = !kickoffAt
        ? 'postponed'
        : finished
          ? 'finished'
          : f.started === 'True' || now >= kickoffAt.getTime()
            ? 'live' // kicked off; stays "live" until the dataset reports it finished
            : 'scheduled';
      return {
        ref: `fpl27:f${f.id}`,
        gameweek: f.event ? num(f.event) : null,
        kickoffAt,
        homeClubRef: `fpl27:t${f.team_h}`,
        awayClubRef: `fpl27:t${f.team_a}`,
        status,
        homeScore: finished ? num(f.team_h_score) : null,
        awayScore: finished ? num(f.team_a_score) : null,
      };
    });
  }

  /** No in-play data in the public dataset. */
  async liveMatchStats(): Promise<ProviderStat[]> {
    return [];
  }

  async finalMatchStats(fixtureRef: string): Promise<ProviderStat[]> {
    const id = fixtureRef.replace('fpl27:f', '');
    const [rows, teams] = await Promise.all([this.file('gws/merged_gw.csv'), this.file('teams.csv')]);
    const teamByName = new Map(teams.map((t) => [t.name!, t.id!]));
    return rows
      .filter((r) => r.fixture === id)
      .map((r) => ({
        playerRef: `fpl27:p${r.element}`,
        clubRef: `fpl27:t${teamByName.get(r.team!) ?? ''}`,
        stats: {
          status: 'finished' as const,
          minutes: num(r.minutes),
          goals: num(r.goals_scored),
          assists: num(r.assists),
          cleanSheet: num(r.clean_sheets) >= 1,
          goalsConceded: num(r.goals_conceded),
          saves: num(r.saves),
          penaltiesSaved: num(r.penalties_saved),
          yellowCards: num(r.yellow_cards),
          redCards: num(r.red_cards),
        },
      }));
  }

  /** Club changes and departures are detected by the reference sync against the current squads file. */
  async transfers(): Promise<ProviderMove[]> {
    return [];
  }
}
