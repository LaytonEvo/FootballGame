import { and, desc, eq, inArray } from 'drizzle-orm';
import type { SquadScore } from '@ff/scoring';
import type { AppContext } from '../context.js';
import { MINUTE } from '../clock.js';
import {
  clubs,
  fixtures,
  gameweekScores,
  notifications,
  playerMatchStats,
  players,
  selections,
} from '../db/schema.js';
import { registerHomeExtra } from './home.js';
import type { StoredSelection } from './selection-body.js';

type Fixture = typeof fixtures.$inferSelect;

/** Match minute shown on the name plate, from the server clock (half-time allowed for). */
export function matchMinute(kickoff: Date, now: Date): number {
  const m = Math.floor((now.getTime() - kickoff.getTime()) / MINUTE);
  return Math.max(1, Math.min(90, m <= 45 ? m : m <= 60 ? 45 : m - 15));
}

/** Live mini-league movement is filled in by the leagues module. */
export type LeagueMovesFn = (ctx: AppContext, userId: string, gameweekId: string) => Promise<unknown[]>;
let leagueMoves: LeagueMovesFn = async () => [];
export const setLeagueMovesProvider = (f: LeagueMovesFn) => {
  leagueMoves = f;
};

export async function liveForUser(ctx: AppContext, userId: string, gameweekId: string) {
  const [row] = await ctx.db
    .select()
    .from(gameweekScores)
    .where(and(eq(gameweekScores.userId, userId), eq(gameweekScores.gameweekId, gameweekId)));
  const [sel] = await ctx.db
    .select()
    .from(selections)
    .where(and(eq(selections.userId, userId), eq(selections.gameweekId, gameweekId)));
  if (!sel?.lockedAt) return null;
  const body = sel.body as StoredSelection;
  const picks = [...body.starters, ...(body.sub ? [body.sub] : [])];
  const info = new Map(
    (
      await ctx.db
        .select({ id: players.id, name: players.name, n: players.shirtNumber })
        .from(players)
        .where(
          inArray(
            players.id,
            picks.map((p) => p.playerId),
          ),
        )
    ).map((p) => [p.id, p]),
  );
  const fx = await ctx.db.select().from(fixtures).where(eq(fixtures.gameweekId, gameweekId));
  const codes = new Map(
    (await ctx.db.select({ id: clubs.id, code: clubs.code }).from(clubs)).map((c) => [c.id, c.code]),
  );
  const goals = new Map<string, number>(); // fixtureId:clubId → goals (live score)
  if (fx.length) {
    for (const r of await ctx.db
      .select()
      .from(playerMatchStats)
      .where(
        inArray(
          playerMatchStats.fixtureId,
          fx.map((f) => f.id),
        ),
      )) {
      const k = `${r.fixtureId}:${r.clubId}`;
      goals.set(k, (goals.get(k) ?? 0) + Number((r.stats as { goals: number }).goals ?? 0));
    }
  }
  const now = ctx.clock.now();
  const label = (f: Fixture) => {
    const hs = f.homeScore ?? goals.get(`${f.id}:${f.homeClubId}`) ?? 0;
    const as = f.awayScore ?? goals.get(`${f.id}:${f.awayClubId}`) ?? 0;
    if (f.voided || f.status === 'postponed' || f.status === 'abandoned') return 'Void';
    if (f.status === 'finished') return `${hs}–${as} · FT`;
    if (f.status === 'live' && f.kickoffAt) return `${hs}–${as} · ${matchMinute(f.kickoffAt, now)}’`;
    return f.kickoffAt
      ? new Intl.DateTimeFormat('en-GB', {
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: 'Europe/London',
        })
          .format(f.kickoffAt)
          .replace(',', '')
      : 'TBC';
  };
  const score = row?.breakdown as SquadScore | undefined;
  const slots = picks.map((p, i) => {
    const slot = i < body.starters.length ? i : 5;
    const s = score?.slots.find((x) => x.slot === slot);
    const myFx = fx.filter((f) => p.clubId && (f.homeClubId === p.clubId || f.awayClubId === p.clubId));
    return {
      slot,
      name: info.get(p.playerId)?.name ?? '',
      position: p.position,
      rarity: p.rarity,
      shirtNumber: info.get(p.playerId)?.n ?? null,
      clubCode: p.clubId ? codes.get(p.clubId) : null,
      role: s?.role ?? (slot === 5 ? 'sub_pending' : 'starter'),
      points: s?.points ?? 0,
      captain: body.captain === slot,
      matchLabel: myFx.length ? myFx.map(label).join(', ') : 'No match',
      lines: (
        s?.lines ??
        p.actions.map((a) => ({
          actionId: a,
          label: a,
          state: 'pending',
          points: 0,
          potential: 0,
          bold: false,
          explanation: '',
        }))
      ).map((l) => ({
        actionId: l.actionId,
        label: l.label,
        state: l.state,
        points: l.points,
        potential: l.potential,
        bold: l.bold,
        explanation: l.explanation,
      })),
    };
  });
  const [last] = await ctx.db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.kind, 'action_landed')))
    .orderBy(desc(notifications.createdAt))
    .limit(1);
  const lastData = last?.data as { gameweekId?: string; points?: number } | undefined;
  return {
    total: score?.total ?? 0,
    provisional: row?.provisional ?? true,
    slots,
    lastLanded:
      last && lastData?.gameweekId === gameweekId
        ? {
            name: last.title.split(':')[0] ?? '',
            label: last.title.split(': ')[1]?.replace(' landed', '') ?? '',
            points: lastData.points ?? 0,
          }
        : null,
    leagueMoves: await leagueMoves(ctx, userId, gameweekId),
  };
}

registerHomeExtra(async (ctx, userId, gw) => {
  if (!gw || gw.status === 'upcoming') return {};
  return { live: await liveForUser(ctx, userId, gw.id) };
});
