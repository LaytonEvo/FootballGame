import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { PackReward } from '@ff/shared';
import type { AppContext } from '../context.js';
import type { DbOrTx } from '../db/client.js';
import { cards, coinLedger, gameweekScores, gameweeks, packs, squadSlots, users } from '../db/schema.js';
import { conflict, notFound } from '../errors.js';
import { track } from './analytics.js';
import { getEconomy, getPacksConfig, SEASON } from './config.js';
import { grantPack, oddsFor } from './packs.js';
import type { PackType } from './packs.js';
import { autoFillSquad } from './squad.js';

type Reason = (typeof coinLedger.$inferSelect)['reason'];

/** Balance is always derived from the immutable ledger. There is no balance column. */
export async function coinBalance(db: DbOrTx, userId: string): Promise<number> {
  const [r] = await db
    .select({ b: sql<number>`coalesce(sum(${coinLedger.amount}), 0)::int` })
    .from(coinLedger)
    .where(eq(coinLedger.userId, userId));
  return r?.b ?? 0;
}

/** Append a ledger row. Idempotent on key: returns false if this key was already recorded. */
export async function ledger(
  db: DbOrTx,
  at: Date,
  userId: string,
  amount: number,
  reason: Reason,
  key: string,
  ref: string | null = null,
) {
  const rows = await db
    .insert(coinLedger)
    .values({ userId, amount, reason, ref, idempotencyKey: key, createdAt: at })
    .onConflictDoNothing({ target: coinLedger.idempotencyKey })
    .returning();
  return rows.length > 0;
}

/** 1 Coin per point scored, credited once at finalisation. A negative week earns 0 (never a debit). */
export async function creditGameweekCoins(ctx: AppContext, gameweekId: string) {
  const rows = await ctx.db
    .select()
    .from(gameweekScores)
    .where(and(eq(gameweekScores.gameweekId, gameweekId), eq(gameweekScores.provisional, false)));
  let credited = 0;
  for (const r of rows) {
    if (r.total <= 0) continue;
    if (
      await ledger(
        ctx.db,
        ctx.clock.now(),
        r.userId,
        r.total,
        'gameweek_points',
        `gw:${gameweekId}:${r.userId}`,
        gameweekId,
      )
    )
      credited += 1;
  }
  return credited;
}

const REWARD_PACK: Record<PackReward, PackType> = {
  player_pack: 'player',
  silver_pack: 'silver',
  gold_pack: 'gold',
  elite_pack: 'elite',
  squad_pack: 'squad',
};

export async function seasonPoints(db: DbOrTx, userId: string, season = SEASON) {
  const [r] = await db
    .select({ p: sql<number>`coalesce(sum(${gameweekScores.total}), 0)::int` })
    .from(gameweekScores)
    .innerJoin(gameweeks, eq(gameweeks.id, gameweekScores.gameweekId))
    .where(
      and(
        eq(gameweekScores.userId, userId),
        eq(gameweeks.season, season),
        eq(gameweekScores.provisional, false),
      ),
    );
  return r?.p ?? 0;
}

/** Grant every milestone whose threshold is reached. Exactly once per milestone per season (grant keys). */
export async function grantMilestones(ctx: AppContext, userIds: string[], season = SEASON) {
  const eco = await getEconomy(ctx.db, season);
  let granted = 0;
  for (const userId of userIds) {
    const pts = await seasonPoints(ctx.db, userId, season);
    for (const m of eco.season_milestones) {
      if (pts < m.season_points) continue;
      const { created } = await grantPack(
        ctx.db,
        ctx.clock.now(),
        userId,
        REWARD_PACK[m.reward],
        'milestone',
        `milestone:${season}:${m.season_points}:${userId}`,
      );
      if (created) granted += 1;
    }
  }
  return granted;
}

/** Serialise spends per user (row lock on Postgres; PGlite is single-connection). */
async function lockUser(db: DbOrTx, userId: string) {
  await db.execute(sql`select id from ${users} where ${users.id} = ${userId} for update`);
}

/** Buy a pack with Coins. `requestKey` (client Idempotency-Key) makes retries safe. */
export async function buyPack(
  ctx: AppContext,
  userId: string,
  item: 'player_pack' | 'squad_pack',
  requestKey: string,
) {
  const eco = await getEconomy(ctx.db);
  const price = eco.prices_coins[item];
  const now = ctx.clock.now();
  return ctx.db.transaction(async (tx) => {
    await lockUser(tx, userId);
    const key = `buy:${userId}:${requestKey}`;
    const [existing] = await tx.select().from(packs).where(eq(packs.grantKey, key));
    if (existing) return { pack: existing, balance: await coinBalance(tx, userId) };
    const balance = await coinBalance(tx, userId);
    if (balance < price) throw conflict('insufficient_coins', `You need ${price - balance} more Coins`);
    const { pack } = await grantPack(
      tx,
      now,
      userId,
      item === 'player_pack' ? 'player' : 'squad',
      'coins',
      key,
    );
    await ledger(tx, now, userId, -price, 'pack_purchase', `spend:${key}`, pack.id);
    await track(tx, now, userId, 'coins_spent', { item, price });
    return { pack, balance: balance - price };
  });
}

/**
 * Swap a card for a swap pack of the same rarity (costs card_swap Coins). The old card leaves the collection
 * for good (inactive, `swapped`) and the squad is auto-filled if it was in the five.
 */
export async function swapCard(ctx: AppContext, userId: string, cardId: string) {
  const eco = await getEconomy(ctx.db);
  const price = eco.prices_coins.card_swap;
  const now = ctx.clock.now();
  return ctx.db.transaction(async (tx) => {
    await lockUser(tx, userId);
    const [card] = await tx
      .select()
      .from(cards)
      .where(and(eq(cards.id, cardId), eq(cards.userId, userId)));
    if (!card) throw notFound('Card');
    if (card.swappedAt) throw conflict('already_swapped', 'This card was already swapped');
    const balance = await coinBalance(tx, userId);
    if (balance < price) throw conflict('insufficient_coins', `You need ${price - balance} more Coins`);
    await tx
      .update(cards)
      .set({ swappedAt: now, active: false, inactiveReason: 'swapped' })
      .where(eq(cards.id, cardId));
    await tx.delete(squadSlots).where(eq(squadSlots.cardId, cardId));
    const { pack } = await grantPack(tx, now, userId, 'swap', 'swap', `swap:${cardId}`, card.rarity);
    await ledger(tx, now, userId, -price, 'card_swap', `swap:${cardId}`, pack.id);
    await autoFillSquad(tx, userId);
    await track(tx, now, userId, 'coins_spent', { item: 'card_swap', price });
    return { packId: pack.id, balance: balance - price };
  });
}

export async function rewardsScreen(ctx: AppContext, userId: string) {
  const [eco, packsCfg, balance, pts] = await Promise.all([
    getEconomy(ctx.db),
    getPacksConfig(ctx.db),
    coinBalance(ctx.db, userId),
    seasonPoints(ctx.db, userId),
  ]);
  const granted = new Set(
    (
      await ctx.db
        .select({ k: packs.grantKey })
        .from(packs)
        .where(and(eq(packs.userId, userId), eq(packs.source, 'milestone')))
    ).map((p) => p.k),
  );
  const milestones = eco.season_milestones.map((m) => ({
    ...m,
    done: granted.has(`milestone:${SEASON}:${m.season_points}:${userId}`),
  }));
  const next = milestones.find((m) => !m.done) ?? null;
  const [upcoming] = await ctx.db
    .select()
    .from(gameweeks)
    .where(and(eq(gameweeks.season, SEASON), eq(gameweeks.status, 'upcoming')))
    .orderBy(gameweeks.number)
    .limit(1);
  const weekly = upcoming
    ? (
        await ctx.db
          .select()
          .from(packs)
          .where(eq(packs.grantKey, `weekly:${userId}:${upcoming.id}`))
      )[0]
    : undefined;
  const recent = await ctx.db
    .select()
    .from(coinLedger)
    .where(eq(coinLedger.userId, userId))
    .orderBy(desc(coinLedger.id))
    .limit(20);
  return {
    coins: balance,
    seasonPoints: pts,
    nextPack: {
      price: eco.prices_coins.player_pack,
      toGo: Math.max(0, eco.prices_coins.player_pack - balance),
    },
    milestones,
    nextMilestone: next && { ...next, toGo: Math.max(0, next.season_points - pts) },
    weeklyFreePack: upcoming
      ? { gameweek: upcoming.number, unlocked: !!weekly, packId: weekly?.id ?? null }
      : null,
    shop: [
      {
        item: 'player_pack',
        name: 'Player pack',
        desc: '1 player, any position',
        price: eco.prices_coins.player_pack,
        odds: oddsFor(packsCfg, { type: 'player', rarity: null }),
      },
      {
        item: 'card_swap',
        name: 'Card swap',
        desc: 'Trade a card for a same-rarity pack',
        price: eco.prices_coins.card_swap,
        odds: null,
      },
      {
        item: 'squad_pack',
        name: 'Squad pack',
        desc: '5 players in the squad shape',
        price: eco.prices_coins.squad_pack,
        odds: oddsFor(packsCfg, { type: 'squad', rarity: null }),
      },
    ],
    oddsVersion: packsCfg.version,
    ledger: recent,
  };
}

export async function ledgerFor(db: DbOrTx, userIds: string[]) {
  return userIds.length ? db.select().from(coinLedger).where(inArray(coinLedger.userId, userIds)) : [];
}
