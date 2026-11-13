import { and, desc, eq, gte, inArray, lte, or } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { DAY, HOUR } from '../clock.js';
import type { DbOrTx } from '../db/client.js';
import { cards, clubs, editions, leagueMembers, players, squadSlots, trades, users } from '../db/schema.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { newId } from '../ids.js';
import { track } from './analytics.js';
import { getEconomy } from './config.js';
import { notify } from './notifications.js';
import { autoFillSquad } from './squad.js';

/**
 * Card-for-card trading. One of your cards for one of theirs, between players who share a mini-league.
 * No Coins, money or one-way gifts, so cards never carry a real-money value.
 */
async function rules(db: DbOrTx) {
  const t = (await getEconomy(db)).trading;
  if (!t?.enabled) throw forbidden('trading_off', 'Trading is not switched on');
  return t;
}

async function shareLeague(db: DbOrTx, a: string, b: string) {
  const mine = (
    await db.select({ l: leagueMembers.leagueId }).from(leagueMembers).where(eq(leagueMembers.userId, a))
  ).map((r) => r.l);
  if (!mine.length) return false;
  const theirs = await db
    .select({ l: leagueMembers.leagueId })
    .from(leagueMembers)
    .where(and(eq(leagueMembers.userId, b), inArray(leagueMembers.leagueId, mine)));
  return theirs.length > 0;
}

/** Everyone you share a mini-league with (people you can trade with). */
export async function tradePartners(db: DbOrTx, userId: string) {
  const mine = (
    await db.select({ l: leagueMembers.leagueId }).from(leagueMembers).where(eq(leagueMembers.userId, userId))
  ).map((r) => r.l);
  if (!mine.length) return [];
  const rows = await db
    .selectDistinct({ id: users.id, name: users.displayName })
    .from(leagueMembers)
    .innerJoin(users, eq(users.id, leagueMembers.userId))
    .where(inArray(leagueMembers.leagueId, mine));
  return rows.filter((r) => r.id !== userId).map((r) => ({ id: r.id, name: r.name ?? 'Player' }));
}

const cardView = (db: DbOrTx, ids: string[]) =>
  ids.length
    ? db
        .select({
          card: cards,
          player: { name: players.name, position: players.position },
          clubCode: clubs.code,
          edition: { name: editions.name, supply: editions.supply },
        })
        .from(cards)
        .innerJoin(players, eq(players.id, cards.playerId))
        .leftJoin(clubs, eq(clubs.id, players.clubId))
        .leftJoin(editions, eq(editions.id, cards.editionId))
        .where(inArray(cards.id, ids))
    : Promise.resolve([]);

/** A partner's tradeable cards (active, not swapped). Only for people you share a league with. */
export async function partnerCards(ctx: AppContext, userId: string, partnerId: string) {
  const t = await rules(ctx.db);
  if (t.same_league_required && !(await shareLeague(ctx.db, userId, partnerId)))
    throw forbidden('not_league_mate', 'You can only trade with people in your mini-leagues');
  const ids = (
    await ctx.db
      .select({ id: cards.id })
      .from(cards)
      .where(and(eq(cards.userId, partnerId), eq(cards.active, true)))
  ).map((c) => c.id);
  return cardView(ctx.db, ids);
}

async function checkEligible(
  db: DbOrTx,
  now: Date,
  t: NonNullable<Awaited<ReturnType<typeof getEconomy>>['trading']>,
  userId: string,
) {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) throw notFound('Player');
  if (now.getTime() - u.createdAt.getTime() < t.min_account_age_days * DAY) {
    throw forbidden('account_too_new', `Accounts can trade after ${t.min_account_age_days} days`);
  }
  const weekAgo = new Date(now.getTime() - 7 * DAY);
  const recent = await db
    .select({ id: trades.id })
    .from(trades)
    .where(
      and(
        eq(trades.status, 'accepted'),
        gte(trades.respondedAt, weekAgo),
        or(eq(trades.fromUserId, userId), eq(trades.toUserId, userId)),
      ),
    );
  if (recent.length >= t.max_trades_per_week)
    throw conflict('trade_limit', `Max ${t.max_trades_per_week} trades a week`);
}

async function ownedActive(db: DbOrTx, cardId: string, userId: string) {
  const [c] = await db.select().from(cards).where(eq(cards.id, cardId));
  if (!c || c.userId !== userId) throw badRequest('card_not_owned', 'That card is no longer theirs to trade');
  if (!c.active || c.swappedAt) throw badRequest('card_inactive', 'Inactive cards can’t be traded');
  return c;
}

export async function offerTrade(
  ctx: AppContext,
  fromUserId: string,
  input: { offeredCardId: string; toUserId: string; requestedCardId: string },
) {
  const t = await rules(ctx.db);
  const now = ctx.clock.now();
  if (input.toUserId === fromUserId) throw badRequest('self_trade', 'Pick someone else');
  if (t.same_league_required && !(await shareLeague(ctx.db, fromUserId, input.toUserId)))
    throw forbidden('not_league_mate', 'You can only trade with people in your mini-leagues');
  await checkEligible(ctx.db, now, t, fromUserId);
  await checkEligible(ctx.db, now, t, input.toUserId);
  await ownedActive(ctx.db, input.offeredCardId, fromUserId);
  await ownedActive(ctx.db, input.requestedCardId, input.toUserId);
  const live = await ctx.db
    .select({ id: trades.id })
    .from(trades)
    .where(and(eq(trades.status, 'open'), eq(trades.offeredCardId, input.offeredCardId)));
  if (live.length) throw conflict('already_offered', 'You already have an open offer with that card');
  const id = newId();
  await ctx.db
    .insert(trades)
    .values({
      id,
      fromUserId,
      ...input,
      createdAt: now,
      expiresAt: new Date(now.getTime() + t.offer_expiry_hours * HOUR),
    });
  const [from] = await ctx.db.select({ n: users.displayName }).from(users).where(eq(users.id, fromUserId));
  const view = await cardView(ctx.db, [input.offeredCardId, input.requestedCardId]);
  const offered = view.find((c) => c.card.id === input.offeredCardId)!;
  const requested = view.find((c) => c.card.id === input.requestedCardId)!;
  await notify(ctx.db, now, {
    userId: input.toUserId,
    kind: 'trade',
    title: `${from?.n ?? 'A league-mate'} wants to trade`,
    body: `Their ${offered.player.name} for your ${requested.player.name}`,
    data: { route: '/trades', tradeId: id },
    dedupeKey: `trade-offer:${id}`,
  });
  await track(ctx.db, now, fromUserId, 'trade_offered', { tradeId: id });
  return (await ctx.db.select().from(trades).where(eq(trades.id, id)))[0]!;
}

async function openTrade(db: DbOrTx, id: string) {
  const [tr] = await db.select().from(trades).where(eq(trades.id, id));
  if (!tr) throw notFound('Trade');
  if (tr.status !== 'open') throw conflict('trade_closed', `This offer is ${tr.status}`);
  return tr;
}

/** Accept: re-check everything, swap owners, take both cards out of squads (auto-filled), close clashing offers. */
export async function acceptTrade(ctx: AppContext, userId: string, id: string) {
  const t = await rules(ctx.db);
  const now = ctx.clock.now();
  return ctx.db.transaction(async (tx) => {
    const tr = await openTrade(tx, id);
    if (tr.toUserId !== userId)
      throw forbidden('not_yours', 'Only the person offered the trade can accept it');
    if (tr.expiresAt <= now) {
      await tx.update(trades).set({ status: 'expired', respondedAt: now }).where(eq(trades.id, id));
      throw conflict('trade_closed', 'This offer has expired');
    }
    await checkEligible(tx, now, t, tr.fromUserId);
    await checkEligible(tx, now, t, tr.toUserId);
    if (t.same_league_required && !(await shareLeague(tx, tr.fromUserId, tr.toUserId)))
      throw forbidden('not_league_mate', 'You no longer share a mini-league');
    await ownedActive(tx, tr.offeredCardId, tr.fromUserId);
    await ownedActive(tx, tr.requestedCardId, tr.toUserId);
    await tx.update(cards).set({ userId: tr.toUserId }).where(eq(cards.id, tr.offeredCardId));
    await tx.update(cards).set({ userId: tr.fromUserId }).where(eq(cards.id, tr.requestedCardId));
    await tx.delete(squadSlots).where(inArray(squadSlots.cardId, [tr.offeredCardId, tr.requestedCardId]));
    await autoFillSquad(tx, tr.fromUserId);
    await autoFillSquad(tx, tr.toUserId);
    await tx.update(trades).set({ status: 'accepted', respondedAt: now }).where(eq(trades.id, id));
    // Any other open offer involving either card can no longer happen.
    await tx
      .update(trades)
      .set({ status: 'cancelled', reason: 'card_traded', respondedAt: now })
      .where(
        and(
          eq(trades.status, 'open'),
          or(
            inArray(trades.offeredCardId, [tr.offeredCardId, tr.requestedCardId]),
            inArray(trades.requestedCardId, [tr.offeredCardId, tr.requestedCardId]),
          ),
        ),
      );
    const [to] = await tx.select({ n: users.displayName }).from(users).where(eq(users.id, userId));
    await notify(tx, now, {
      userId: tr.fromUserId,
      kind: 'trade',
      title: `${to?.n ?? 'Your league-mate'} accepted your trade`,
      body: 'The card is in your collection. Check your five.',
      data: { route: '/collection', tradeId: id },
      dedupeKey: `trade-accepted:${id}`,
    });
    await track(tx, now, userId, 'trade_accepted', { tradeId: id });
    return (await tx.select().from(trades).where(eq(trades.id, id)))[0]!;
  });
}

export async function closeTrade(ctx: AppContext, userId: string, id: string, action: 'decline' | 'cancel') {
  const tr = await openTrade(ctx.db, id);
  if (action === 'decline' && tr.toUserId !== userId)
    throw forbidden('not_yours', 'Only the person offered the trade can decline it');
  if (action === 'cancel' && tr.fromUserId !== userId)
    throw forbidden('not_yours', 'Only the person who offered can cancel');
  await ctx.db
    .update(trades)
    .set({ status: action === 'decline' ? 'declined' : 'cancelled', respondedAt: ctx.clock.now() })
    .where(eq(trades.id, id));
  return (await ctx.db.select().from(trades).where(eq(trades.id, id)))[0]!;
}

/** Tick job: close offers past their expiry. */
export async function expireTrades(ctx: AppContext) {
  const now = ctx.clock.now();
  const rows = await ctx.db
    .update(trades)
    .set({ status: 'expired', respondedAt: now })
    .where(and(eq(trades.status, 'open'), lte(trades.expiresAt, now)))
    .returning();
  return rows.length;
}

/** Trades screen: incoming and outgoing open offers, plus recent history, with card details. */
export async function tradesScreen(ctx: AppContext, userId: string) {
  const rows = await ctx.db
    .select()
    .from(trades)
    .where(or(eq(trades.fromUserId, userId), eq(trades.toUserId, userId)))
    .orderBy(desc(trades.createdAt))
    .limit(50);
  const cardsById = new Map(
    (
      await cardView(
        ctx.db,
        rows.flatMap((r) => [r.offeredCardId, r.requestedCardId]),
      )
    ).map((c) => [c.card.id, c]),
  );
  const names = new Map(
    rows.length
      ? (
          await ctx.db
            .select({ id: users.id, n: users.displayName })
            .from(users)
            .where(inArray(users.id, [...new Set(rows.flatMap((r) => [r.fromUserId, r.toUserId]))]))
        ).map((u) => [u.id, u.n ?? 'Player'])
      : [],
  );
  const view = (r: (typeof rows)[number]) => ({
    id: r.id,
    status: r.status,
    reason: r.reason,
    direction: r.fromUserId === userId ? ('outgoing' as const) : ('incoming' as const),
    otherName: names.get(r.fromUserId === userId ? r.toUserId : r.fromUserId) ?? 'Player',
    give: cardsById.get(r.fromUserId === userId ? r.offeredCardId : r.requestedCardId) ?? null,
    get: cardsById.get(r.fromUserId === userId ? r.requestedCardId : r.offeredCardId) ?? null,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
  });
  const all = rows.map(view);
  return {
    incoming: all.filter((t) => t.status === 'open' && t.direction === 'incoming'),
    outgoing: all.filter((t) => t.status === 'open' && t.direction === 'outgoing'),
    history: all.filter((t) => t.status !== 'open').slice(0, 20),
  };
}
