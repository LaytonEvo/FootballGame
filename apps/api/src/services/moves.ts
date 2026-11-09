import { and, asc, eq, gt, inArray, isNull, lte } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import type { DbOrTx } from '../db/client.js';
import { cards, clubs, gameweeks, playerMoves, players, squadSlots } from '../db/schema.js';
import { newId } from '../ids.js';
import { SEASON } from './config.js';
import { grantPack } from './packs.js';
import { autoFillSquad } from './squad.js';

type MoveKind = (typeof playerMoves.$inferSelect)['kind'];

/** First gameweek whose deadline is after the registration time. */
async function effectiveGameweek(db: DbOrTx, registeredAt: Date) {
  const [gw] = await db
    .select()
    .from(gameweeks)
    .where(and(eq(gameweeks.season, SEASON), gt(gameweeks.deadlineAt, registeredAt)))
    .orderBy(asc(gameweeks.deadlineAt))
    .limit(1);
  return gw ?? null;
}

/** Record a move (from the provider or staff). Idempotent on ref. */
export async function recordMove(
  db: DbOrTx,
  m: { ref: string; playerId: string; kind: MoveKind; toClubId: string | null; registeredAt: Date },
) {
  const gw = await effectiveGameweek(db, m.registeredAt);
  const [row] = await db
    .insert(playerMoves)
    .values({ id: newId(), ...m, effectiveGameweekId: gw?.id ?? null })
    .onConflictDoNothing({ target: playerMoves.ref })
    .returning();
  return row ?? null;
}

/** Pull new moves from the provider. */
export async function ingestMoves(ctx: AppContext, since: Date) {
  const moves = await ctx.provider.transfers(since);
  const refs = [...new Set(moves.map((m) => m.playerRef))];
  const pids = new Map(
    refs.length
      ? (
          await ctx.db
            .select({ id: players.id, ref: players.providerRef })
            .from(players)
            .where(inArray(players.providerRef, refs))
        ).map((p) => [p.ref, p.id])
      : [],
  );
  const cids = new Map(
    (await ctx.db.select({ id: clubs.id, ref: clubs.providerRef }).from(clubs)).map((c) => [c.ref, c.id]),
  );
  let added = 0;
  for (const m of moves) {
    const playerId = pids.get(m.playerRef);
    if (!playerId) continue;
    const row = await recordMove(ctx.db, {
      ref: m.ref,
      playerId,
      kind: m.kind,
      toClubId: m.toClubRef ? (cids.get(m.toClubRef) ?? null) : null,
      registeredAt: m.registeredAt,
    });
    if (row) added += 1;
  }
  return added;
}

export interface CardChange {
  userId: string;
  cardId: string;
  playerId: string;
  kind: MoveKind | 'relegated';
  compensationPackId?: string;
}

/** Deactivate every card for a player, pull them from squads, grant a same-rarity swap pack per card. */
async function deactivatePlayerCards(
  db: DbOrTx,
  at: Date,
  playerId: string,
  reason: string,
  keyPrefix: string,
  kind: CardChange['kind'],
) {
  const owned = await db
    .select()
    .from(cards)
    .where(and(eq(cards.playerId, playerId), eq(cards.active, true), isNull(cards.swappedAt)));
  const changes: CardChange[] = [];
  for (const c of owned) {
    await db.update(cards).set({ active: false, inactiveReason: reason }).where(eq(cards.id, c.id));
    await db.delete(squadSlots).where(eq(squadSlots.cardId, c.id));
    const { pack } = await grantPack(
      db,
      at,
      c.userId,
      'swap',
      'compensation',
      `${keyPrefix}:${c.id}`,
      c.rarity,
    );
    await autoFillSquad(db, c.userId);
    changes.push({ userId: c.userId, cardId: c.id, playerId, kind, compensationPackId: pack.id });
  }
  return changes;
}

/**
 * Apply moves whose effective gameweek deadline has arrived (run before locking). Transfers: the card follows
 * the player. Leaving the league / retiring: cards inactive + free swap pack of the same rarity. Returning:
 * cards reactivate (the owner keeps the swap-pack card too). Idempotent via processed_at.
 */
export async function processDueMoves(ctx: AppContext): Promise<CardChange[]> {
  const now = ctx.clock.now();
  const due = await ctx.db
    .select({ move: playerMoves, gw: gameweeks })
    .from(playerMoves)
    .leftJoin(gameweeks, eq(gameweeks.id, playerMoves.effectiveGameweekId))
    .where(isNull(playerMoves.processedAt))
    .orderBy(asc(playerMoves.registeredAt));
  const changes: CardChange[] = [];
  for (const { move, gw } of due) {
    // No future gameweek (end of season): apply straight away.
    if (gw && gw.deadlineAt > now) continue;
    await ctx.db.transaction(async (tx) => {
      switch (move.kind) {
        case 'transfer': {
          await tx
            .update(players)
            .set({ clubId: move.toClubId, status: 'active' })
            .where(eq(players.id, move.playerId));
          const owners = await tx
            .select()
            .from(cards)
            .where(and(eq(cards.playerId, move.playerId), eq(cards.active, true)));
          for (const c of owners)
            changes.push({ userId: c.userId, cardId: c.id, playerId: move.playerId, kind: 'transfer' });
          break;
        }
        case 'left_league':
        case 'retired':
          await tx
            .update(players)
            .set({ status: move.kind, clubId: null })
            .where(eq(players.id, move.playerId));
          changes.push(
            ...(await deactivatePlayerCards(tx, now, move.playerId, move.kind, `comp:${move.id}`, move.kind)),
          );
          break;
        case 'returned': {
          await tx
            .update(players)
            .set({ status: 'active', clubId: move.toClubId })
            .where(eq(players.id, move.playerId));
          const back = await tx
            .update(cards)
            .set({ active: true, inactiveReason: null })
            .where(and(eq(cards.playerId, move.playerId), eq(cards.active, false), isNull(cards.swappedAt)))
            .returning();
          for (const c of back)
            changes.push({ userId: c.userId, cardId: c.id, playerId: move.playerId, kind: 'returned' });
          break;
        }
      }
      await tx.update(playerMoves).set({ processedAt: now }).where(eq(playerMoves.id, move.id));
    });
  }
  return changes;
}

/**
 * Season end: a relegated club leaves the league. Its players' cards go inactive with a free same-rarity swap
 * pack per card. Idempotent (grant keys and the in_league flag).
 */
export async function relegateClub(ctx: AppContext, clubId: string): Promise<CardChange[]> {
  const now = ctx.clock.now();
  return ctx.db.transaction(async (tx) => {
    await tx.update(clubs).set({ inLeague: false }).where(eq(clubs.id, clubId));
    const squad = await tx.select().from(players).where(eq(players.clubId, clubId));
    const changes: CardChange[] = [];
    for (const p of squad)
      changes.push(
        ...(await deactivatePlayerCards(tx, now, p.id, 'relegated', `releg:${clubId}`, 'relegated')),
      );
    return changes;
  });
}

/** Promoted club: its players join the pack pool. */
export async function promoteClub(ctx: AppContext, clubId: string) {
  await ctx.db.update(clubs).set({ inLeague: true }).where(eq(clubs.id, clubId));
}

export { lte };
