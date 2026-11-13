import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { PlayerMatchStats, Position } from '@ff/shared';
import { rarityForRating } from '@ff/shared';
import { mulberry32, pickOne } from '@ff/scoring';
import type { AppContext } from '../context.js';
import type { DbOrTx } from '../db/client.js';
import {
  cards,
  clubs,
  editions,
  fixtures,
  gameweekScores,
  gameweeks,
  packs,
  playerMatchStats,
  players,
  users,
} from '../db/schema.js';
import { newId } from '../ids.js';
import { getEconomy, getPacksConfig } from './config.js';
import type { PackCardResult, PackRow } from './packs.js';
import { grantPack, oddsFor } from './packs.js';
import { rankStandings } from './leagues.js';

type Stats = Omit<PlayerMatchStats, 'playerId' | 'fixtureId'>;

/** How good a gameweek a player had, for picking the Team of the Week. Position-aware, simple, explainable. */
export function performanceScore(
  position: Position,
  s: Pick<Stats, 'minutes' | 'goals' | 'assists' | 'cleanSheet' | 'saves' | 'yellowCards' | 'redCards'>,
): number {
  if (s.minutes <= 0) return 0;
  const goal = { GK: 10, DEF: 8, MID: 6, FWD: 5 }[position];
  const cs = position === 'GK' || position === 'DEF' ? 5 : position === 'MID' ? 1 : 0;
  return (
    s.goals * goal +
    s.assists * 4 +
    (s.cleanSheet ? cs : 0) +
    (position === 'GK' ? Math.floor(s.saves / 3) * 2 : 0) +
    (s.minutes >= 60 ? 2 : 1) -
    s.yellowCards -
    s.redCards * 3
  );
}

/** Best GK, DEF, two MIDs and a FWD of a gameweek (combined stats for double gameweeks). */
export async function pickTeamOfTheWeek(db: DbOrTx, gameweekId: string) {
  const rows = await db
    .select({ s: playerMatchStats, p: players })
    .from(playerMatchStats)
    .innerJoin(fixtures, eq(fixtures.id, playerMatchStats.fixtureId))
    .innerJoin(players, eq(players.id, playerMatchStats.playerId))
    .where(eq(fixtures.gameweekId, gameweekId));
  const totals = new Map<string, { player: typeof players.$inferSelect; stats: Stats }>();
  for (const r of rows) {
    const st = r.s.stats as Stats;
    const t = totals.get(r.p.id);
    if (!t) totals.set(r.p.id, { player: r.p, stats: { ...st } });
    else {
      t.stats.minutes += st.minutes;
      t.stats.goals += st.goals;
      t.stats.assists += st.assists;
      t.stats.cleanSheet = t.stats.cleanSheet || st.cleanSheet;
      t.stats.saves += st.saves;
      t.stats.yellowCards += st.yellowCards;
      t.stats.redCards += st.redCards;
    }
  }
  const ranked = [...totals.values()]
    .map((t) => ({ ...t, score: performanceScore(t.player.position, t.stats) }))
    .filter((t) => t.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || b.stats.minutes - a.stats.minutes || a.player.name.localeCompare(b.player.name),
    );
  const pick = (pos: Position, n: number) => ranked.filter((r) => r.player.position === pos).slice(0, n);
  return [...pick('GK', 1), ...pick('DEF', 1), ...pick('MID', 2), ...pick('FWD', 1)];
}

/**
 * After a gameweek is final: create its Team of the Week edition (idempotent) and give the top X% of that
 * week's players a Team of the Week pack each (idempotent grant keys). Earned only, never sold.
 */
export async function runTeamOfTheWeek(ctx: AppContext, gameweekId: string) {
  const eco = await getEconomy(ctx.db);
  const cfg = eco.editions?.team_of_the_week;
  if (!cfg) return { edition: 0, awarded: 0 };
  const [gw] = await ctx.db.select().from(gameweeks).where(eq(gameweeks.id, gameweekId));
  if (!gw) return { edition: 0, awarded: 0 };
  const team = await pickTeamOfTheWeek(ctx.db, gameweekId);
  for (const t of team) {
    await ctx.db
      .insert(editions)
      .values({
        id: newId(),
        kind: 'team_of_the_week',
        name: `Team of the Week · GW${gw.number}`,
        gameweekId,
        playerId: t.player.id,
        supply: cfg.supply_per_player,
      })
      .onConflictDoNothing();
  }
  if (team.length === 0) return { edition: 0, awarded: 0 };

  // Top X% of the week (ties broken as in the league tables), only players who scored.
  const rows = await ctx.db
    .select({
      userId: gameweekScores.userId,
      points: gameweekScores.total,
      landed: gameweekScores.actionsLanded,
      picked: gameweekScores.actionsPicked,
      name: users.displayName,
    })
    .from(gameweekScores)
    .innerJoin(users, eq(users.id, gameweekScores.userId))
    .where(and(eq(gameweekScores.gameweekId, gameweekId), eq(gameweekScores.provisional, false)));
  const standings = rankStandings(
    rows.filter((r) => r.points > 0).map((r) => ({ ...r, name: r.name ?? 'Player' })),
  );
  const n = Math.max(standings.length ? 1 : 0, Math.ceil((standings.length * cfg.award_top_percent) / 100));
  const cutoff = standings[n - 1]?.rank ?? 0;
  const winners = standings.filter((s) => s.rank <= cutoff); // a tie at the cut-off is included
  let awarded = 0;
  for (const w of winners) {
    const { created } = await grantPack(
      ctx.db,
      ctx.clock.now(),
      w.userId,
      'totw',
      'team_of_the_week',
      `totw:${gameweekId}:${w.userId}`,
      null,
      { gameweekId },
    );
    if (created) awarded += 1;
  }
  return { edition: team.length, awarded };
}

/**
 * Open a Team of the Week pack: one numbered card, drawn with equal chance from that week's editions that still
 * have supply and that the player doesn't already hold. Returns null if none are left (caller falls back).
 */
export async function openTeamOfTheWeekPack(
  tx: DbOrTx,
  at: Date,
  userId: string,
  pack: PackRow,
  seed: number,
) {
  if (!pack.gameweekId) return null;
  const ownedEditions = new Set(
    (
      await tx
        .select({ e: cards.editionId })
        .from(cards)
        .where(and(eq(cards.userId, userId)))
    )
      .map((c) => c.e)
      .filter(Boolean),
  );
  const open = (
    await tx
      .select()
      .from(editions)
      .where(and(eq(editions.gameweekId, pack.gameweekId), lt(editions.issued, editions.supply)))
      .orderBy(asc(editions.id))
  ).filter((e) => !ownedEditions.has(e.id));
  if (open.length === 0) return null;
  const edition = pickOne(mulberry32(seed), open);
  // Atomic: never issue more than the supply, even with two packs opened at once.
  const [issued] = await tx
    .update(editions)
    .set({ issued: sql`${editions.issued} + 1` })
    .where(and(eq(editions.id, edition.id), lt(editions.issued, editions.supply)))
    .returning();
  if (!issued) return null;
  const [p] = await tx
    .select({ player: players, clubCode: clubs.code })
    .from(players)
    .leftJoin(clubs, eq(clubs.id, players.clubId))
    .where(eq(players.id, edition.playerId));
  const packsCfg = await getPacksConfig(tx);
  const rarity = rarityForRating(packsCfg, p!.player.rating);
  const cardId = newId();
  await tx.insert(cards).values({
    id: cardId,
    userId,
    playerId: p!.player.id,
    rarity,
    rating: p!.player.rating,
    clubAtOpeningId: p!.player.clubId,
    packId: pack.id,
    editionId: edition.id,
    serial: issued.issued,
  });
  const result: PackCardResult = {
    cardId,
    playerId: p!.player.id,
    name: p!.player.name,
    position: p!.player.position,
    clubCode: p!.clubCode,
    rarity,
    rating: p!.player.rating,
    duplicate: false,
    level: 1,
    edition: { name: edition.name, serial: issued.issued, supply: edition.supply },
  };
  const odds = oddsFor(packsCfg, pack);
  const [opened] = await tx
    .update(packs)
    .set({
      status: 'opened',
      openedAt: at,
      oddsVersion: packsCfg.version,
      seed: String(seed),
      result: { cards: [result], editions: open.map((e) => e.id), odds },
    })
    .where(and(eq(packs.id, pack.id), eq(packs.status, 'sealed')))
    .returning();
  if (!opened) return null;
  return { pack: opened, cards: [result], odds, oddsVersion: packsCfg.version };
}

export async function editionsFor(db: DbOrTx, ids: string[]) {
  return ids.length ? db.select().from(editions).where(inArray(editions.id, ids)) : [];
}
