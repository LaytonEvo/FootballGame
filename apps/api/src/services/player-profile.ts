import { and, asc, desc, eq, gt, inArray, or } from 'drizzle-orm';
import type { PlayerMatchStats } from '@ff/shared';
import { TIER_LABEL, rarityForRating } from '@ff/shared';
import { availableActions, formHint } from '@ff/scoring';
import type { DbOrTx } from '../db/client.js';
import { cards, clubs, fixtures, gameweeks, playerMatchStats, players } from '../db/schema.js';
import { notFound } from '../errors.js';
import { getPacksConfig, getRules, SEASON } from './config.js';

type Stats = Omit<PlayerMatchStats, 'playerId' | 'fixtureId'>;

/**
 * Player profile: who they are, season totals, recent matches, how often each scoring action would have
 * landed, upcoming fixtures, and the viewer's own cards of this player. Names, numbers, positions and club
 * codes only (unlicensed test build: no photos or crests).
 */
export async function playerProfile(db: DbOrTx, playerId: string, viewerId: string | null) {
  const [p] = await db
    .select({ player: players, club: clubs })
    .from(players)
    .leftJoin(clubs, eq(clubs.id, players.clubId))
    .where(eq(players.id, playerId));
  if (!p) throw notFound('Player');
  const [rules, packsCfg] = await Promise.all([getRules(db), getPacksConfig(db)]);
  const codes = new Map(
    (await db.select({ id: clubs.id, code: clubs.code }).from(clubs)).map((c) => [c.id, c.code]),
  );

  // Every match this season with stats (played gameweeks only).
  const rows = await db
    .select({ s: playerMatchStats, f: fixtures, gw: gameweeks })
    .from(playerMatchStats)
    .innerJoin(fixtures, eq(fixtures.id, playerMatchStats.fixtureId))
    .innerJoin(gameweeks, eq(gameweeks.id, fixtures.gameweekId))
    .where(
      and(
        eq(playerMatchStats.playerId, playerId),
        eq(gameweeks.season, SEASON),
        inArray(gameweeks.status, ['live', 'provisional', 'finalised']),
      ),
    )
    .orderBy(desc(gameweeks.number), desc(fixtures.kickoffAt));
  const matches = rows.map((r) => {
    const st = r.s.stats as Stats;
    const home = r.f.homeClubId === r.s.clubId;
    const opp = codes.get(home ? r.f.awayClubId : r.f.homeClubId);
    return {
      gameweek: r.gw.number,
      gameweekId: r.gw.id,
      opponent: `v ${opp} (${home ? 'H' : 'A'})`,
      score:
        r.f.homeScore !== null && r.f.awayScore !== null
          ? `${home ? r.f.homeScore : r.f.awayScore}–${home ? r.f.awayScore : r.f.homeScore}`
          : null,
      stats: { ...st, playerId, fixtureId: r.f.id } as PlayerMatchStats,
    };
  });
  const sum = (k: keyof Stats) => matches.reduce((t, m) => t + Number(m.stats[k] ?? 0), 0);
  const season = {
    appearances: matches.filter((m) => m.stats.minutes > 0).length,
    minutes: sum('minutes'),
    goals: sum('goals'),
    assists: sum('assists'),
    cleanSheets: matches.filter((m) => m.stats.cleanSheet).length,
    saves: sum('saves'),
    penaltiesSaved: sum('penaltiesSaved'),
    yellowCards: sum('yellowCards'),
    redCards: sum('redCards'),
  };

  // Per gameweek (double gameweeks combined), most recent first — the same shape the form hints use.
  const byGw = new Map<number, PlayerMatchStats[]>();
  for (const m of matches) byGw.set(m.gameweek, [...(byGw.get(m.gameweek) ?? []), m.stats]);
  const history = [...byGw.entries()].sort((a, b) => b[0] - a[0]).map(([, ms]) => ms);
  const actions = availableActions(rules, p.player.position).map((a) => {
    const last5 = formHint(rules, a.id, p.player.position, history, 5);
    const all = formHint(rules, a.id, p.player.position, history, 99);
    return {
      id: a.id,
      label: a.label,
      tier: a.tier,
      tierLabel: TIER_LABEL[a.tier],
      points: a.points,
      last5: { hits: last5.hits, of: last5.of },
      season: { hits: all.hits, of: all.of },
    };
  });

  const upcoming = p.player.clubId
    ? await db
        .select({ f: fixtures, gw: gameweeks })
        .from(fixtures)
        .innerJoin(gameweeks, eq(gameweeks.id, fixtures.gameweekId))
        .where(
          and(
            or(eq(fixtures.homeClubId, p.player.clubId), eq(fixtures.awayClubId, p.player.clubId)),
            eq(gameweeks.season, SEASON),
            gt(fixtures.kickoffAt, new Date(0)),
            eq(fixtures.status, 'scheduled'),
          ),
        )
        .orderBy(asc(fixtures.kickoffAt))
        .limit(3)
    : [];
  const owned = viewerId
    ? await db
        .select()
        .from(cards)
        .where(and(eq(cards.userId, viewerId), eq(cards.playerId, playerId)))
    : [];

  return {
    player: {
      id: p.player.id,
      name: p.player.name,
      position: p.player.position,
      shirtNumber: p.player.shirtNumber,
      club: p.club ? { code: p.club.code, name: p.club.name } : null,
      status: p.player.status,
      rating: p.player.rating,
      rarity: rarityForRating(packsCfg, p.player.rating),
    },
    season,
    recent: matches.slice(0, 6).map((m) => ({
      gameweek: m.gameweek,
      opponent: m.opponent,
      score: m.score,
      minutes: m.stats.minutes,
      goals: m.stats.goals,
      assists: m.stats.assists,
      cleanSheet: m.stats.cleanSheet,
      saves: m.stats.saves,
      yellowCards: m.stats.yellowCards,
    })),
    actions,
    upcoming: upcoming.map(({ f, gw }) => {
      const home = f.homeClubId === p.player.clubId;
      return {
        gameweek: gw.number,
        label: `v ${codes.get(home ? f.awayClubId : f.homeClubId)} (${home ? 'H' : 'A'})`,
        kickoffAt: f.kickoffAt,
      };
    }),
    myCards: owned.map((c) => ({
      id: c.id,
      rarity: c.rarity,
      rating: c.rating,
      level: c.level,
      active: c.active,
    })),
  };
}
