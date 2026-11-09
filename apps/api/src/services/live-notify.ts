import { inArray } from 'drizzle-orm';
import type { SquadScore } from '@ff/scoring';
import type { AppContext } from '../context.js';
import type { gameweeks } from '../db/schema.js';
import { players } from '../db/schema.js';
import type { ScoredUser } from './scoring.js';
import type { CardChange } from './moves.js';
import { LANDED_BATCH_MS, notify } from './notifications.js';
import { plateName } from './text.js';

type Gameweek = typeof gameweeks.$inferSelect;

/** Lines that are landed now but were not in the previous score. */
export function newlyLanded(prev: SquadScore | null, next: SquadScore) {
  const before = new Set(
    prev?.slots.flatMap((s) =>
      s.counts ? s.lines.filter((l) => l.state === 'landed').map((l) => `${s.slot}:${l.actionId}`) : [],
    ) ?? [],
  );
  return next.slots.flatMap((s) =>
    s.counts
      ? s.lines
          .filter((l) => l.state === 'landed' && !before.has(`${s.slot}:${l.actionId}`))
          .map((l) => ({ slot: s.slot, playerId: s.playerId, line: l }))
      : [],
  );
}

export async function queueLandedAlerts(
  ctx: AppContext,
  gw: Pick<Gameweek, 'id' | 'number'>,
  scored: ScoredUser[],
) {
  const now = ctx.clock.now();
  const items = scored.flatMap((u) =>
    newlyLanded(u.previous, u.score).map((x) => ({ userId: u.userId, ...x })),
  );
  if (!items.length) return 0;
  const names = new Map(
    (
      await ctx.db
        .select({ id: players.id, name: players.name })
        .from(players)
        .where(inArray(players.id, [...new Set(items.map((i) => i.playerId))]))
    ).map((p) => [p.id, p.name]),
  );
  for (const i of items) {
    const who = plateName(names.get(i.playerId) ?? '');
    await notify(ctx.db, now, {
      userId: i.userId,
      kind: 'action_landed',
      title: `${who}: ${i.line.label} landed`,
      body: `${who} +${i.line.points}`,
      data: { gameweekId: gw.id, slot: i.slot, actionId: i.line.actionId, points: i.line.points },
      dedupeKey: `landed:${gw.id}:${i.userId}:${i.slot}:${i.line.actionId}`,
      sendAfter: new Date(now.getTime() + LANDED_BATCH_MS),
    });
  }
  return items.length;
}

export async function queueCarriedOver(
  ctx: AppContext,
  gw: Pick<Gameweek, 'id' | 'number'>,
  userIds: string[],
) {
  const now = ctx.clock.now();
  for (const userId of userIds) {
    await notify(ctx.db, now, {
      userId,
      kind: 'actions_carried_over',
      title: `GW${gw.number}: last week's actions carried over`,
      body: 'No penalty. Your picks from last week are locked in.',
      data: { route: '/' },
      dedupeKey: `carried:${gw.id}:${userId}`,
    });
  }
}

export async function queueRecapReady(
  ctx: AppContext,
  gw: Pick<Gameweek, 'id' | 'number'>,
  scored: ScoredUser[],
) {
  const now = ctx.clock.now();
  for (const u of scored) {
    await notify(ctx.db, now, {
      userId: u.userId,
      kind: 'recap_ready',
      title: `Your GW${gw.number} recap is ready`,
      body: `${u.score.total} pts · ${u.score.actionsLanded} of ${u.score.actionsPicked} actions landed`,
      data: { route: `/recap/${gw.id}` },
      dedupeKey: `recap:${gw.id}:${u.userId}`,
    });
  }
}

/** One grouped notification per user per batch of card changes (transfer window). */
export async function queueCardChanges(ctx: AppContext, changes: CardChange[]) {
  const now = ctx.clock.now();
  const byUser = new Map<string, CardChange[]>();
  for (const c of changes) byUser.set(c.userId, [...(byUser.get(c.userId) ?? []), c]);
  if (!byUser.size) return;
  const names = new Map(
    (
      await ctx.db
        .select({ id: players.id, name: players.name })
        .from(players)
        .where(inArray(players.id, [...new Set(changes.map((c) => c.playerId))]))
    ).map((p) => [p.id, p.name]),
  );
  const verb = {
    transfer: 'changed club',
    left_league: 'left the league',
    retired: 'retired',
    returned: 'is back in the league',
    relegated: 'was relegated',
  } as const;
  for (const [userId, list] of byUser) {
    const lines = list.map((c) => `${plateName(names.get(c.playerId) ?? '')} ${verb[c.kind]}`);
    const packs = list.filter((c) => c.compensationPackId).length;
    await notify(ctx.db, now, {
      userId,
      kind: 'card_changed',
      title: list.length === 1 ? lines[0]! : `${list.length} of your cards changed`,
      body: `${lines.join(' · ')}${packs ? ` · ${packs} free swap pack${packs > 1 ? 's' : ''}` : ''}`,
      data: { route: '/collection' },
      dedupeKey: `cards:${userId}:${now.toISOString()}`,
    });
  }
}
