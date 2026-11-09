import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import type { DbOrTx } from '../db/client.js';
import { gameweekScores, gameweeks, leagueMembers, leagues, users } from '../db/schema.js';
import { badRequest, notFound } from '../errors.js';
import { newId, shortCode } from '../ids.js';
import { track } from './analytics.js';
import { SEASON } from './config.js';
import { londonDate } from '../time.js';

export interface StandingInput {
  userId: string;
  name: string;
  points: number;
  landed: number;
  picked: number;
}
export interface Standing extends StandingInput {
  rank: number;
}

/** Sort and rank: points, then most actions landed, then fewest actions picked. Exact ties share a rank. */
export function rankStandings(rows: StandingInput[]): Standing[] {
  const sorted = [...rows].sort(
    (a, b) =>
      b.points - a.points || b.landed - a.landed || a.picked - b.picked || a.name.localeCompare(b.name),
  );
  let rank = 0;
  return sorted.map((r, i) => {
    const prev = sorted[i - 1];
    if (!prev || prev.points !== r.points || prev.landed !== r.landed || prev.picked !== r.picked)
      rank = i + 1;
    return { ...r, rank };
  });
}

export type TableView =
  { kind: 'season' } | { kind: 'week'; gameweekId: string } | { kind: 'month'; month: string };

async function seasonGameweeks(db: DbOrTx, season = SEASON) {
  return db.select().from(gameweeks).where(eq(gameweeks.season, season)).orderBy(asc(gameweeks.number));
}

/** Totals per user over a set of gameweeks (provisional scores included, so tables move live). */
async function totals(db: DbOrTx, gwIds: string[], userIds: string[] | null): Promise<StandingInput[]> {
  if (gwIds.length === 0) return [];
  const where = userIds
    ? and(inArray(gameweekScores.gameweekId, gwIds), inArray(gameweekScores.userId, userIds))
    : inArray(gameweekScores.gameweekId, gwIds);
  const rows = await db
    .select({
      userId: gameweekScores.userId,
      points: sql<number>`coalesce(sum(${gameweekScores.total}), 0)::int`,
      landed: sql<number>`coalesce(sum(${gameweekScores.actionsLanded}), 0)::int`,
      picked: sql<number>`coalesce(sum(${gameweekScores.actionsPicked}), 0)::int`,
    })
    .from(gameweekScores)
    .where(where)
    .groupBy(gameweekScores.userId);
  const ids = userIds ?? rows.map((r) => r.userId);
  const names = new Map(
    ids.length
      ? (
          await db.select({ id: users.id, n: users.displayName }).from(users).where(inArray(users.id, ids))
        ).map((u) => [u.id, u.n ?? 'Player'])
      : [],
  );
  const byUser = new Map(rows.map((r) => [r.userId, r]));
  return ids.map((id) => ({
    userId: id,
    name: names.get(id) ?? 'Player',
    points: byUser.get(id)?.points ?? 0,
    landed: byUser.get(id)?.landed ?? 0,
    picked: byUser.get(id)?.picked ?? 0,
  }));
}

/** Gameweeks that count for a view, plus the "before" set used for movement arrows. */
async function viewGameweeks(db: DbOrTx, view: TableView) {
  const all = await seasonGameweeks(db);
  const started = all.filter((g) => g.status !== 'upcoming');
  if (view.kind === 'week') return { now: [view.gameweekId], before: null as string[] | null };
  if (view.kind === 'month') {
    const inMonth = started.filter((g) => {
      const d = londonDate(g.deadlineAt);
      return `${d.y}-${String(d.m).padStart(2, '0')}` === view.month;
    });
    return { now: inMonth.map((g) => g.id), before: inMonth.slice(0, -1).map((g) => g.id) };
  }
  return { now: started.map((g) => g.id), before: started.slice(0, -1).map((g) => g.id) };
}

export async function table(db: DbOrTx, view: TableView, userIds: string[] | null) {
  const { now, before } = await viewGameweeks(db, view);
  const current = rankStandings(await totals(db, now, userIds));
  const prev = before
    ? new Map(
        rankStandings(await totals(db, before, userIds ?? current.map((c) => c.userId))).map((r) => [
          r.userId,
          r.rank,
        ]),
      )
    : null;
  return current.map((r) => ({
    ...r,
    previousRank: prev && before!.length ? (prev.get(r.userId) ?? null) : null,
  }));
}

export async function createLeague(ctx: AppContext, ownerId: string, name: string) {
  const n = name.trim();
  if (n.length < 2 || n.length > 30) throw badRequest('bad_name', 'League name must be 2-30 characters');
  const now = ctx.clock.now();
  const id = newId();
  await ctx.db.insert(leagues).values({ id, name: n, code: shortCode(6), ownerId, createdAt: now });
  await ctx.db.insert(leagueMembers).values({ leagueId: id, userId: ownerId, joinedAt: now });
  await track(ctx.db, now, ownerId, 'league_created', { leagueId: id });
  const [l] = await ctx.db.select().from(leagues).where(eq(leagues.id, id));
  return l!;
}

/**
 * Resolve an invite code: a league code, or a player's personal invite code (from their share card), which
 * opens that player's own mini-league (created on first use).
 */
export async function leagueByCode(db: DbOrTx, raw: string, now = new Date()) {
  const code = raw.trim().toUpperCase();
  const [l] = await db.select().from(leagues).where(eq(leagues.code, code));
  if (l) return l;
  const [inviter] = await db.select().from(users).where(eq(users.inviteCode, code));
  if (!inviter) throw notFound('League');
  const id = newId();
  await db
    .insert(leagues)
    .values({
      id,
      name: `${inviter.displayName ?? 'Player'}'s league`,
      code,
      ownerId: inviter.id,
      createdAt: now,
    })
    .onConflictDoNothing({ target: leagues.code });
  const [created] = await db.select().from(leagues).where(eq(leagues.code, code));
  await db
    .insert(leagueMembers)
    .values({ leagueId: created!.id, userId: inviter.id, joinedAt: now })
    .onConflictDoNothing();
  return created!;
}

export async function joinLeague(ctx: AppContext, userId: string, code: string) {
  const now = ctx.clock.now();
  const l = await leagueByCode(ctx.db, code, now);
  const inserted = await ctx.db
    .insert(leagueMembers)
    .values({ leagueId: l.id, userId, joinedAt: now })
    .onConflictDoNothing()
    .returning();
  if (inserted.length) {
    await track(ctx.db, now, userId, 'league_joined', { leagueId: l.id });
    await track(ctx.db, now, l.ownerId, 'invite_accepted', { leagueId: l.id, by: userId });
  }
  return l;
}

export async function leaveLeague(ctx: AppContext, userId: string, leagueId: string) {
  await ctx.db
    .delete(leagueMembers)
    .where(and(eq(leagueMembers.leagueId, leagueId), eq(leagueMembers.userId, userId)));
}

export async function memberIds(db: DbOrTx, leagueId: string) {
  return (
    await db
      .select({ u: leagueMembers.userId })
      .from(leagueMembers)
      .where(eq(leagueMembers.leagueId, leagueId))
  ).map((r) => r.u);
}

export async function myLeagues(db: DbOrTx, userId: string) {
  return db
    .select({
      id: leagues.id,
      name: leagues.name,
      code: leagues.code,
      ownerId: leagues.ownerId,
      joinedAt: leagueMembers.joinedAt,
    })
    .from(leagueMembers)
    .innerJoin(leagues, eq(leagues.id, leagueMembers.leagueId))
    .where(eq(leagueMembers.userId, userId))
    .orderBy(desc(leagueMembers.joinedAt));
}

export const inviteLinks = (code: string) => ({
  code,
  url: `${process.env.PUBLIC_WEB_URL ?? 'https://fantasyfive.test'}/join/${code}`,
  appUrl: `fantasyfive://join/${code}`,
});

/** "My season": totals, average, best week, per-gameweek bars with the league average, recent weeks. */
export async function mySeason(db: DbOrTx, userId: string, leagueId: string | null) {
  const gws = (await seasonGameweeks(db)).filter((g) => g.status !== 'upcoming');
  const ids = leagueId ? await memberIds(db, leagueId) : null;
  const rows = gws.length
    ? await db
        .select()
        .from(gameweekScores)
        .where(
          inArray(
            gameweekScores.gameweekId,
            gws.map((g) => g.id),
          ),
        )
    : [];
  const pool = ids ? rows.filter((r) => ids.includes(r.userId)) : rows;
  const weeks = gws.map((g) => {
    const mine = rows.find((r) => r.gameweekId === g.id && r.userId === userId);
    const others = pool.filter((r) => r.gameweekId === g.id);
    return {
      gameweekId: g.id,
      number: g.number,
      points: mine?.total ?? null,
      landed: mine?.actionsLanded ?? 0,
      picked: mine?.actionsPicked ?? 0,
      provisional: mine?.provisional ?? false,
      average: others.length
        ? Math.round((others.reduce((s, r) => s + r.total, 0) / others.length) * 10) / 10
        : null,
    };
  });
  const played = weeks.filter((w) => w.points !== null);
  const total = played.reduce((s, w) => s + (w.points ?? 0), 0);
  const best = played.reduce<(typeof played)[number] | null>(
    (b, w) => (!b || (w.points ?? 0) > (b.points ?? 0) ? w : b),
    null,
  );
  return {
    total,
    average: played.length ? Math.round((total / played.length) * 10) / 10 : 0,
    best: best && { number: best.number, points: best.points },
    weeks,
  };
}

/** Live movement in each of a user's leagues: rank with the current gameweek vs before it. */
export async function leagueMovesFor(ctx: AppContext, userId: string, gameweekId: string) {
  const all = await seasonGameweeks(ctx.db);
  const cur = all.find((g) => g.id === gameweekId);
  if (!cur) return [];
  const started = all.filter((g) => g.status !== 'upcoming' && g.number <= cur.number).map((g) => g.id);
  const before = all.filter((g) => g.status !== 'upcoming' && g.number < cur.number).map((g) => g.id);
  const out = [];
  for (const l of await myLeagues(ctx.db, userId)) {
    const ids = await memberIds(ctx.db, l.id);
    const now = rankStandings(await totals(ctx.db, started, ids)).find((r) => r.userId === userId);
    const prev = before.length
      ? rankStandings(await totals(ctx.db, before, ids)).find((r) => r.userId === userId)
      : null;
    out.push({
      leagueId: l.id,
      name: l.name,
      rank: now?.rank ?? ids.length,
      previousRank: prev?.rank ?? null,
      size: ids.length,
    });
  }
  return out;
}
