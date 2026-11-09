import { and, eq, inArray } from 'drizzle-orm';
import type { PlayerMatchStats } from '@ff/shared';
import type { AppContext } from '../context.js';
import type { DbOrTx } from '../db/client.js';
import { clubs, fixtures, playerMatchStats, players, statRevisions } from '../db/schema.js';
import type { ProviderStat } from '../providers/types.js';
import type { StoredSelection } from './selection-body.js';

type Fixture = typeof fixtures.$inferSelect;
type Stats = Omit<PlayerMatchStats, 'playerId' | 'fixtureId'>;

const KEYS: (keyof Stats)[] = [
  'status',
  'minutes',
  'goals',
  'assists',
  'cleanSheet',
  'goalsConceded',
  'saves',
  'penaltiesSaved',
  'yellowCards',
  'redCards',
  'tackles',
  'cbi',
  'defensiveContribution',
];
const normalise = (s: Stats): Stats =>
  Object.fromEntries(KEYS.filter((k) => s[k] !== undefined).map((k) => [k, s[k]])) as unknown as Stats;
// Postgres jsonb reorders keys, so compare field by field in a fixed order.
const same = (a: Stats, b: Stats) => JSON.stringify(normalise(a)) === JSON.stringify(normalise(b));

export interface IngestResult {
  changed: number;
  rejectedAfterFinalisation: number;
}

/**
 * Store provider stats for one fixture. Changed rows bump the revision and are logged in stat_revisions.
 * After the gameweek is finalised nothing changes: revisions are logged with applied = false.
 */
export async function ingestFixtureStats(
  ctx: AppContext,
  fx: Fixture,
  incoming: ProviderStat[],
  finalised: boolean,
): Promise<IngestResult> {
  const { db } = ctx;
  const now = ctx.clock.now();
  const refs = [...new Set(incoming.map((s) => s.playerRef))];
  const playerIdByRef = new Map(
    refs.length
      ? (
          await db
            .select({ id: players.id, ref: players.providerRef })
            .from(players)
            .where(inArray(players.providerRef, refs))
        ).map((p) => [p.ref, p.id])
      : [],
  );
  const clubIdByRef = new Map(
    (await db.select({ id: clubs.id, ref: clubs.providerRef }).from(clubs)).map((c) => [c.ref, c.id]),
  );
  const existing = new Map(
    (await db.select().from(playerMatchStats).where(eq(playerMatchStats.fixtureId, fx.id))).map((r) => [
      r.playerId,
      r,
    ]),
  );
  const res: IngestResult = { changed: 0, rejectedAfterFinalisation: 0 };
  for (const s of incoming) {
    const playerId = playerIdByRef.get(s.playerRef);
    const clubId = clubIdByRef.get(s.clubRef);
    if (!playerId || !clubId) continue;
    const stats = normalise(s.stats);
    const prev = existing.get(playerId);
    if (prev && same(prev.stats as Stats, stats)) continue;
    const revision = (prev?.revision ?? 0) + 1;
    if (finalised) {
      await db
        .insert(statRevisions)
        .values({ playerId, fixtureId: fx.id, revision, stats, receivedAt: now, applied: false });
      res.rejectedAfterFinalisation += 1;
      continue;
    }
    await db
      .insert(playerMatchStats)
      .values({ playerId, fixtureId: fx.id, clubId, stats, revision, updatedAt: now })
      .onConflictDoUpdate({
        target: [playerMatchStats.playerId, playerMatchStats.fixtureId],
        set: { stats, revision, updatedAt: now, clubId },
      });
    await db
      .insert(statRevisions)
      .values({ playerId, fixtureId: fx.id, revision, stats, receivedAt: now, applied: true });
    res.changed += 1;
  }
  return res;
}

export interface GameweekStatData {
  fixtures: Fixture[];
  rows: Map<string, PlayerMatchStats[]>;
}

const fixtureStatus = (f: Fixture): PlayerMatchStats['status'] => (f.voided ? 'abandoned' : f.status);

export async function loadGameweekStats(db: DbOrTx, gameweekId: string): Promise<GameweekStatData> {
  const fx = await db.select().from(fixtures).where(eq(fixtures.gameweekId, gameweekId));
  const rows = new Map<string, PlayerMatchStats[]>();
  if (fx.length === 0) return { fixtures: fx, rows };
  const byId = new Map(fx.map((f) => [f.id, f]));
  const stats = await db
    .select()
    .from(playerMatchStats)
    .where(
      inArray(
        playerMatchStats.fixtureId,
        fx.map((f) => f.id),
      ),
    );
  for (const r of stats) {
    const f = byId.get(r.fixtureId)!;
    const s = r.stats as Stats;
    // Fixture-level status (and staff voids) win over the row's own status.
    const status =
      f.voided || f.status === 'postponed' || f.status === 'abandoned' ? fixtureStatus(f) : s.status;
    const m: PlayerMatchStats = { ...s, status, playerId: r.playerId, fixtureId: r.fixtureId };
    rows.set(r.playerId, [...(rows.get(r.playerId) ?? []), m]);
  }
  return { fixtures: fx, rows };
}

/**
 * Stats per picked player. A player whose club (at lock) has a fixture in the gameweek but no stats row gets a
 * 0-minute row with the fixture's status, so pending matches stay pending and unused players count as 0 minutes.
 */
export function statsForSelection(
  sel: StoredSelection,
  data: GameweekStatData,
): Map<string, PlayerMatchStats[]> {
  const out = new Map<string, PlayerMatchStats[]>();
  for (const p of [...sel.starters, ...(sel.sub ? [sel.sub] : [])]) {
    const own = data.rows.get(p.playerId) ?? [];
    const seen = new Set(own.map((m) => m.fixtureId));
    const synth: PlayerMatchStats[] = data.fixtures
      .filter((f) => !seen.has(f.id) && p.clubId && (f.homeClubId === p.clubId || f.awayClubId === p.clubId))
      .map((f) => ({
        playerId: p.playerId,
        fixtureId: f.id,
        status: fixtureStatus(f),
        minutes: 0,
        goals: 0,
        assists: 0,
        cleanSheet: false,
        goalsConceded: 0,
        saves: 0,
        penaltiesSaved: 0,
        yellowCards: 0,
        redCards: 0,
      }));
    out.set(p.playerId, [...own, ...synth]);
  }
  return out;
}

export { and };
