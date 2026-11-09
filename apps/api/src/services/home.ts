import { and, eq } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { gameweekScores, packs, players, selections } from '../db/schema.js';
import { currentGameweek, nextUpcomingGameweek } from './picks.js';
import { getSquad } from './squad.js';

export type HomeExtras = (
  ctx: AppContext,
  userId: string,
  gw: Awaited<ReturnType<typeof currentGameweek>>,
) => Promise<Record<string, unknown>>;
const extras: HomeExtras[] = [];
/** Later phases (coins, leagues, live, recap) add their Home cards here. */
export const registerHomeExtra = (f: HomeExtras) => extras.push(f);

export async function homeScreen(ctx: AppContext, userId: string) {
  const gw = await currentGameweek(ctx.db);
  const now = ctx.clock.now();
  const squad = await getSquad(ctx.db, userId);
  const shirt = new Map(
    (await ctx.db.select({ id: players.id, n: players.shirtNumber }).from(players))
      .filter((p) => squad.some((s) => s.playerId === p.id))
      .map((p) => [p.id, p.n]),
  );
  // Picks always refer to the next gameweek you can still act on.
  const next = await nextUpcomingGameweek(ctx.db);
  const sel = next
    ? (
        await ctx.db
          .select()
          .from(selections)
          .where(and(eq(selections.userId, userId), eq(selections.gameweekId, next.id)))
      )[0]
    : undefined;
  const sealed = await ctx.db
    .select({ id: packs.id, type: packs.type, source: packs.source, grantedAt: packs.grantedAt })
    .from(packs)
    .where(and(eq(packs.userId, userId), eq(packs.status, 'sealed')));
  const score = gw
    ? (
        await ctx.db
          .select()
          .from(gameweekScores)
          .where(and(eq(gameweekScores.userId, userId), eq(gameweekScores.gameweekId, gw.id)))
      )[0]
    : undefined;
  const mode = !gw
    ? 'off_season'
    : gw.status === 'upcoming'
      ? 'pre_deadline'
      : gw.status === 'finalised'
        ? 'finalised'
        : now >= gw.firstKickoffAt
          ? 'live'
          : 'locked';
  const body = sel?.body as { starters: { actions: string[] }[] } | undefined;
  const base = {
    serverTime: now,
    mode,
    gameweek: gw && {
      id: gw.id,
      number: gw.number,
      status: gw.status,
      deadlineAt: gw.deadlineAt,
      firstKickoffAt: gw.firstKickoffAt,
      finaliseAt: gw.finaliseAt,
    },
    next: next && {
      id: next.id,
      number: next.number,
      deadlineAt: next.deadlineAt,
      firstKickoffAt: next.firstKickoffAt,
    },
    picks: {
      confirmed: !!sel?.confirmedAt,
      carriedOver: !!sel?.carriedOver,
      setCount: body ? body.starters.filter((s) => s.actions.length > 0).length : 0,
    },
    squad: squad.map((s) => ({
      slot: s.slot,
      name: s.name,
      position: s.position,
      rarity: s.rarity,
      shirtNumber: shirt.get(s.playerId) ?? null,
      clubCode: s.clubCode,
    })),
    sealedPacks: sealed,
    score: score
      ? {
          total: score.total,
          provisional: score.provisional,
          actionsLanded: score.actionsLanded,
          actionsPicked: score.actionsPicked,
        }
      : null,
  };
  const more = await Promise.all(extras.map((f) => f(ctx, userId, gw)));
  return Object.assign(base, ...more);
}
