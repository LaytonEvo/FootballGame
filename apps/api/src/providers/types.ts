import type { MatchStatus, PlayerMatchStats, Position } from '@ff/shared';

export interface ProviderClub {
  ref: string;
  code: string;
  name: string;
}
export interface ProviderPlayer {
  ref: string;
  name: string;
  position: Position;
  clubRef: string | null;
  shirtNumber: number | null;
  /** Provider's quality signal, ranked within position into a 40-99 card rating by the ingestion job. */
  rating: number;
  /** First-team regular (ratings are ranked among regulars). */
  regular: boolean;
  /** Registered at a league club, or gone (sold abroad, loaned out, released). Default active. */
  status?: 'active' | 'left_league';
  /** Fitness from the feed: injured / doubtful / suspended, with the feed's news line. */
  availability?: 'injured' | 'doubtful' | 'suspended' | null;
  news?: string | null;
}
export interface ProviderFixture {
  ref: string;
  gameweek: number | null;
  kickoffAt: Date | null;
  homeClubRef: string;
  awayClubRef: string;
  status: MatchStatus;
  homeScore: number | null;
  awayScore: number | null;
}
export interface ProviderStat {
  playerRef: string;
  clubRef: string;
  stats: Omit<PlayerMatchStats, 'playerId' | 'fixtureId'>;
}
export interface ProviderMove {
  ref: string;
  playerRef: string;
  kind: 'transfer' | 'left_league' | 'retired' | 'returned';
  toClubRef: string | null;
  registeredAt: Date;
}

/** The single data-feed interface. Dev/replay: FplDatasetProvider. Production: CommercialProvider. */
export interface DataProvider {
  readonly name: string;
  /** The squads list is the source of truth for clubs and departures (the sync turns changes into moves). */
  readonly squadsAreAuthoritative?: boolean;
  clubs(): Promise<ProviderClub[]>;
  squads(): Promise<ProviderPlayer[]>;
  fixtures(): Promise<ProviderFixture[]>;
  /** In-play stats for one fixture (status live), or final if it has finished. */
  liveMatchStats(fixtureRef: string): Promise<ProviderStat[]>;
  /** Final (possibly revised) stats for a finished fixture. */
  finalMatchStats(fixtureRef: string): Promise<ProviderStat[]>;
  transfers(since: Date): Promise<ProviderMove[]>;
}
