import type { Dataset, DsPlayerMatch } from '@ff/fpl-dataset';
import { loadDataset } from '@ff/fpl-dataset';
import type { MatchStatus } from '@ff/shared';
import type { Clock } from '../clock.js';
import { DAY, MINUTE } from '../clock.js';
import type { DataProvider, ProviderFixture, ProviderMove, ProviderPlayer, ProviderStat } from './types.js';

/** Live replay: a match is "live" for this long after kickoff, then finished. */
export const MATCH_DURATION_MS = 115 * MINUTE;

export interface FplDatasetOptions {
  clock: Clock;
  /** Shift every 2025/26 date by this many days (364 keeps weekdays: GW1 lands in August 2026). */
  shiftDays?: number;
  /** Only expose these gameweeks (fast tests). */
  gameweeks?: number[];
  /** Basic feed: drop tackles / CBI / defensive contribution. Default true. */
  basicFeed?: boolean;
  dataset?: Dataset;
}

type Patch = Partial<ProviderStat['stats']>;

/**
 * Development and replay provider over the public 2025/26 dataset. Matches play out against the injected
 * clock: scheduled before kickoff, live (stats revealed in proportion to elapsed time) for 115 minutes, then
 * finished. Tests can postpone or abandon fixtures and revise stats.
 */
export class FplDatasetProvider implements DataProvider {
  readonly name = 'fpl-dataset';
  private ds: Dataset;
  private shift: number;
  private byFixture = new Map<number, DsPlayerMatch[]>();
  private overrides = new Map<string, MatchStatus>();
  private revisions = new Map<string, Patch>();
  private extraMoves: ProviderMove[] = [];

  constructor(private opts: FplDatasetOptions) {
    this.ds = opts.dataset ?? loadDataset();
    this.shift = (opts.shiftDays ?? 364) * DAY;
    for (const m of this.ds.playerMatches) {
      if (opts.gameweeks && !opts.gameweeks.includes(m.gameweek)) continue;
      const list = this.byFixture.get(m.fixtureId) ?? [];
      list.push(m);
      this.byFixture.set(m.fixtureId, list);
    }
  }

  private shifted(iso: string) {
    return new Date(new Date(iso).getTime() + this.shift);
  }

  // ----- test / staging controls -----
  setFixtureStatus(fixtureRef: string, status: MatchStatus) {
    this.overrides.set(fixtureRef, status);
  }
  reviseStat(fixtureRef: string, playerRef: string, patch: Patch) {
    const k = `${fixtureRef}|${playerRef}`;
    this.revisions.set(k, { ...this.revisions.get(k), ...patch });
  }
  addMove(move: ProviderMove) {
    this.extraMoves.push(move);
  }

  async clubs() {
    return this.ds.teams.map((t) => ({ ref: `fpl:t${t.id}`, code: t.code, name: t.name }));
  }

  async squads(): Promise<ProviderPlayer[]> {
    // Club = the club of the player's most recent match on or before "now" (first match if none yet).
    const now = this.opts.clock.now().getTime();
    const latest = new Map<number, DsPlayerMatch>();
    const seasonMinutes = new Map<number, number>();
    const seasonPoints = new Map<number, number>();
    for (const m of this.ds.playerMatches) {
      seasonMinutes.set(m.playerId, (seasonMinutes.get(m.playerId) ?? 0) + m.stats.minutes);
      seasonPoints.set(m.playerId, (seasonPoints.get(m.playerId) ?? 0) + m.totalPoints);
    }
    const first = new Map<number, DsPlayerMatch>();
    for (const m of this.ds.playerMatches) {
      const f = first.get(m.playerId);
      if (!f || m.kickoff < f.kickoff) first.set(m.playerId, m);
      if (this.shifted(m.kickoff).getTime() <= now) {
        const l = latest.get(m.playerId);
        if (!l || m.kickoff > l.kickoff) latest.set(m.playerId, m);
      }
    }
    // Only players registered by now (pre-season: the GW1 squads).
    const gw1End = Math.max(
      ...this.ds.fixtures
        .filter((f) => f.gameweek === 1 && f.kickoff)
        .map((f) => this.shifted(f.kickoff!).getTime()),
    );
    // A week of look-ahead: a debutant is registered before the deadline of the week they first play.
    const cutoff = Math.max(now + 7 * DAY, gw1End);
    return [...first.values()]
      .filter((f) => this.shifted(f.kickoff).getTime() <= cutoff)
      .map((f) => {
        const cur = latest.get(f.playerId) ?? f;
        return {
          ref: `fpl:p${f.playerId}`,
          name: f.name,
          position: f.position,
          clubRef: `fpl:t${cur.teamId}`,
          shirtNumber: null,
          // Price first; season points break the many price ties (keepers cluster on two or three prices).
          rating: f.value + (seasonPoints.get(f.playerId) ?? 0) / 1000,
          regular: (seasonMinutes.get(f.playerId) ?? 0) >= 900,
        };
      });
  }

  private status(f: Dataset['fixtures'][number]): MatchStatus {
    const ref = `fpl:f${f.id}`;
    const o = this.overrides.get(ref);
    if (o) return o;
    if (!f.kickoff) return 'postponed';
    const k = this.shifted(f.kickoff).getTime();
    const now = this.opts.clock.now().getTime();
    if (now < k) return 'scheduled';
    if (now < k + MATCH_DURATION_MS) return 'live';
    return 'finished';
  }

  async fixtures(): Promise<ProviderFixture[]> {
    return this.ds.fixtures
      .filter(
        (f) => !this.opts.gameweeks || (f.gameweek !== null && this.opts.gameweeks.includes(f.gameweek)),
      )
      .map((f) => {
        const status = this.status(f);
        const done = status === 'finished';
        return {
          ref: `fpl:f${f.id}`,
          gameweek: f.gameweek,
          kickoffAt: f.kickoff ? this.shifted(f.kickoff) : null,
          homeClubRef: `fpl:t${f.homeTeamId}`,
          awayClubRef: `fpl:t${f.awayTeamId}`,
          status,
          homeScore: done ? f.homeScore : null,
          awayScore: done ? f.awayScore : null,
        };
      });
  }

  private statsFor(fixtureRef: string, partial: boolean): ProviderStat[] {
    const id = Number(fixtureRef.replace('fpl:f', ''));
    const fx = this.ds.fixtures.find((f) => f.id === id);
    if (!fx) throw new Error(`Unknown fixture ${fixtureRef}`);
    const status = this.status(fx);
    if (status === 'scheduled' || status === 'postponed') return [];
    let frac = 1;
    if (partial && status === 'live') {
      const k = this.shifted(fx.kickoff!).getTime();
      frac = Math.min(1, (this.opts.clock.now().getTime() - k) / (95 * MINUTE));
    }
    const basic = this.opts.basicFeed ?? true;
    return (this.byFixture.get(id) ?? []).map((m) => {
      const s = m.stats;
      const live = status === 'live' && partial;
      const scale = (n: number) => (live ? Math.floor(n * frac) : n);
      const base: ProviderStat['stats'] = {
        status: status === 'live' && !partial ? 'finished' : status,
        minutes: live ? Math.min(s.minutes, Math.floor(frac * 90)) : s.minutes,
        goals: scale(s.goals),
        assists: scale(s.assists),
        cleanSheet: live ? false : s.cleanSheet,
        goalsConceded: scale(s.goalsConceded),
        saves: scale(s.saves),
        penaltiesSaved: scale(s.penaltiesSaved),
        yellowCards: scale(s.yellowCards),
        redCards: scale(s.redCards),
        ...(basic
          ? {}
          : {
              tackles: scale(s.tackles ?? 0),
              cbi: scale(s.cbi ?? 0),
              defensiveContribution: scale(s.defensiveContribution ?? 0),
            }),
      };
      const patch = this.revisions.get(`${fixtureRef}|fpl:p${m.playerId}`);
      return { playerRef: `fpl:p${m.playerId}`, clubRef: `fpl:t${m.teamId}`, stats: { ...base, ...patch } };
    });
  }

  async liveMatchStats(fixtureRef: string) {
    return this.statsFor(fixtureRef, true);
  }
  async finalMatchStats(fixtureRef: string) {
    return this.statsFor(fixtureRef, false);
  }

  async transfers(since: Date): Promise<ProviderMove[]> {
    // Club changes within the dataset become transfers registered on the day of the first match for the new club.
    const out: ProviderMove[] = [];
    const sorted = [...this.ds.playerMatches].sort(
      (a, b) => a.playerId - b.playerId || a.kickoff.localeCompare(b.kickoff),
    );
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1]!;
      const b = sorted[i]!;
      if (a.playerId === b.playerId && a.teamId !== b.teamId) {
        const registeredAt = new Date(this.shifted(b.kickoff).getTime() - 3 * DAY);
        out.push({
          ref: `fpl:m${b.playerId}:${b.fixtureId}`,
          playerRef: `fpl:p${b.playerId}`,
          kind: 'transfer',
          toClubRef: `fpl:t${b.teamId}`,
          registeredAt,
        });
      }
    }
    const now = this.opts.clock.now();
    return [...out, ...this.extraMoves].filter((m) => m.registeredAt >= since && m.registeredAt <= now);
  }
}
