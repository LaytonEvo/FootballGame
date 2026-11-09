import { eq, inArray } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { clubs, fixtures, gameweeks, players } from '../db/schema.js';
import { newId } from '../ids.js';
import { deadlineFor, finalisationTime } from '../time.js';
import { SEASON } from './config.js';
import { ratingFromProviderValue } from './ratings.js';

/**
 * Upsert clubs, players and fixtures from the provider and create/refresh gameweeks.
 * Idempotent. Never changes a locked gameweek's deadline. Player clubs only change through processed moves
 * (transfers take effect from the next deadline), so this job sets a club only for new players.
 */
export async function syncReferenceData(ctx: AppContext, season = SEASON) {
  const { db, provider } = ctx;
  const [pClubs, pPlayers, pFixtures] = await Promise.all([
    provider.clubs(),
    provider.squads(),
    provider.fixtures(),
  ]);

  const clubIdByRef = new Map((await db.select().from(clubs)).map((c) => [c.providerRef, c.id]));
  for (const c of pClubs) {
    if (clubIdByRef.has(c.ref)) {
      await db.update(clubs).set({ code: c.code, name: c.name }).where(eq(clubs.providerRef, c.ref));
    } else {
      const id = newId();
      await db.insert(clubs).values({ id, providerRef: c.ref, code: c.code, name: c.name });
      clubIdByRef.set(c.ref, id);
    }
  }

  const existingPlayers = new Map(
    (await db.select({ id: players.id, ref: players.providerRef }).from(players)).map((p) => [p.ref, p.id]),
  );
  const newPlayers = pPlayers
    .filter((p) => !existingPlayers.has(p.ref))
    .map((p) => ({
      id: newId(),
      providerRef: p.ref,
      name: p.name,
      position: p.position,
      shirtNumber: p.shirtNumber,
      clubId: p.clubRef ? (clubIdByRef.get(p.clubRef) ?? null) : null,
      rating: ratingFromProviderValue(p.rating),
    }));
  for (let i = 0; i < newPlayers.length; i += 500)
    await db.insert(players).values(newPlayers.slice(i, i + 500));

  // Gameweeks from fixture kick-offs.
  const byGw = new Map<number, Date[]>();
  for (const f of pFixtures) {
    if (f.gameweek === null || !f.kickoffAt) continue;
    byGw.set(f.gameweek, [...(byGw.get(f.gameweek) ?? []), f.kickoffAt]);
  }
  const gwRows = await db.select().from(gameweeks).where(eq(gameweeks.season, season));
  const gwIdByNumber = new Map(gwRows.map((g) => [g.number, g.id]));
  for (const [number, kicks] of [...byGw.entries()].sort((a, b) => a[0] - b[0])) {
    const first = new Date(Math.min(...kicks.map((k) => k.getTime())));
    const last = new Date(Math.max(...kicks.map((k) => k.getTime())));
    const times = {
      firstKickoffAt: first,
      lastKickoffAt: last,
      deadlineAt: deadlineFor(first),
      finaliseAt: finalisationTime(last),
    };
    const existing = gwRows.find((g) => g.number === number);
    if (!existing) {
      const id = newId();
      await db.insert(gameweeks).values({ id, season, number, ...times });
      gwIdByNumber.set(number, id);
    } else if (existing.status === 'upcoming') {
      await db.update(gameweeks).set(times).where(eq(gameweeks.id, existing.id));
    } else {
      // Locked: deadline is fixed; later kick-offs can still extend finalisation.
      await db
        .update(gameweeks)
        .set({ lastKickoffAt: last, finaliseAt: finalisationTime(last) })
        .where(eq(gameweeks.id, existing.id));
    }
  }

  const fxRows = await db.select().from(fixtures);
  const fxByRef = new Map(fxRows.map((f) => [f.providerRef, f]));
  for (const f of pFixtures) {
    const values = {
      gameweekId: f.gameweek === null ? null : (gwIdByNumber.get(f.gameweek) ?? null),
      homeClubId: clubIdByRef.get(f.homeClubRef)!,
      awayClubId: clubIdByRef.get(f.awayClubRef)!,
      kickoffAt: f.kickoffAt,
      status: f.status,
      homeScore: f.homeScore,
      awayScore: f.awayScore,
    };
    const existing = fxByRef.get(f.ref);
    if (existing) await db.update(fixtures).set(values).where(eq(fixtures.id, existing.id));
    else await db.insert(fixtures).values({ id: newId(), providerRef: f.ref, ...values });
  }
  return { clubs: pClubs.length, players: pPlayers.length, fixtures: pFixtures.length, gameweeks: byGw.size };
}

/** Refresh status and score of the given fixtures from the provider. */
export async function refreshFixtures(ctx: AppContext, fixtureIds: string[]) {
  if (fixtureIds.length === 0) return [];
  const rows = await ctx.db.select().from(fixtures).where(inArray(fixtures.id, fixtureIds));
  const byRef = new Map((await ctx.provider.fixtures()).map((f) => [f.ref, f]));
  for (const r of rows) {
    const p = byRef.get(r.providerRef);
    if (!p) continue;
    await ctx.db
      .update(fixtures)
      .set({ status: p.status, homeScore: p.homeScore, awayScore: p.awayScore, kickoffAt: p.kickoffAt })
      .where(eq(fixtures.id, r.id));
  }
  return ctx.db.select().from(fixtures).where(inArray(fixtures.id, fixtureIds));
}
