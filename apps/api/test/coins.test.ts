import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { cards, coinLedger, gameweekScores, gameweeks, packs, squadSlots } from '../src/db/schema.js';
import { tick } from '../src/jobs/tick.js';
import { coinBalance, creditGameweekCoins, grantMilestones, ledger } from '../src/services/coins.js';
import { datasetCtx, findPlayers, giveSquad, signUp } from './fixtures.js';

let t: Awaited<ReturnType<typeof datasetCtx>>;
let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  t = await datasetCtx([1]);
  app = await buildApp(t.ctx);
});
afterAll(() => t.close());

const regulars = () =>
  findPlayers(1, [
    { position: 'GK', where: (m) => m.stats.minutes >= 90 },
    { position: 'DEF', where: (m) => m.stats.minutes >= 90 },
    { position: 'MID', where: (m) => m.stats.minutes >= 90 },
    { position: 'MID', where: (m) => m.stats.minutes >= 90 },
    { position: 'FWD', where: (m) => m.stats.minutes >= 90 },
  ]).map((m) => m.playerId);

describe('Coins and rewards', () => {
  it('credits 1 Coin per point once, reconciles, buys and swaps, grants milestones exactly once', async () => {
    const u = await signUp(app, t, '07700900800');
    await giveSquad(t.db, u.userId, regulars(), 'bronze');
    const [gw] = await t.db.select().from(gameweeks);
    const auto = (
      await app.inject({
        method: 'POST',
        url: '/picks/suggest',
        headers: u.headers,
        payload: { kind: 'auto' },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/picks/${gw!.id}/confirm`,
      headers: u.headers,
      payload: auto.selection,
    });
    t.clock.set(gw!.deadlineAt);
    await tick(t.ctx);
    t.clock.set(gw!.finaliseAt);
    await tick(t.ctx);

    const [score] = await t.db.select().from(gameweekScores).where(eq(gameweekScores.userId, u.userId));
    expect(score!.provisional).toBe(false);
    expect(await coinBalance(t.db, u.userId)).toBe(Math.max(0, score!.total));
    // Re-running finalisation hooks never double-credits.
    expect(await creditGameweekCoins(t.ctx, gw!.id)).toBe(0);
    await tick(t.ctx);
    expect(await coinBalance(t.db, u.userId)).toBe(Math.max(0, score!.total));

    // Top up for the shop test (staff adjustment row; still the ledger).
    await ledger(t.db, t.clock.now(), u.userId, 1000, 'admin_adjustment', 'test:topup');
    const start = await coinBalance(t.db, u.userId);

    const noKey = await app.inject({
      method: 'POST',
      url: '/shop/buy',
      headers: u.headers,
      payload: { item: 'player_pack' },
    });
    expect(noKey.statusCode).toBe(400);
    const buy = await app.inject({
      method: 'POST',
      url: '/shop/buy',
      headers: { ...u.headers, 'idempotency-key': 'req-0001-abc' },
      payload: { item: 'player_pack' },
    });
    expect(buy.statusCode).toBe(200);
    expect(buy.json().balance).toBe(start - 100);
    const retry = await app.inject({
      method: 'POST',
      url: '/shop/buy',
      headers: { ...u.headers, 'idempotency-key': 'req-0001-abc' },
      payload: { item: 'player_pack' },
    });
    expect(retry.json().pack.id).toBe(buy.json().pack.id);
    expect(await coinBalance(t.db, u.userId)).toBe(start - 100);

    const sq = await app.inject({
      method: 'POST',
      url: '/shop/buy',
      headers: { ...u.headers, 'idempotency-key': 'req-0002-abc' },
      payload: { item: 'squad_pack' },
    });
    expect(sq.json().balance).toBe(start - 500);

    // Odds are logged on opening and shown.
    const opened = (
      await app.inject({ method: 'POST', url: `/packs/${buy.json().pack.id}/open`, headers: u.headers })
    ).json();
    expect(opened.oddsVersion).toBe('0.1');
    expect(opened.odds).toEqual({ bronze: 0.6, silver: 0.28, gold: 0.1, elite: 0.02 });
    const [row] = await t.db.select().from(packs).where(eq(packs.id, buy.json().pack.id));
    expect(row!.seed).toBeTruthy();

    // Swap a squad card: costs 60, same-rarity swap pack, card out of the squad.
    const [slot2] = await t.db
      .select()
      .from(squadSlots)
      .where(and(eq(squadSlots.userId, u.userId), eq(squadSlots.slot, 2)));
    const swap = await app.inject({
      method: 'POST',
      url: `/cards/${slot2!.cardId}/swap`,
      headers: u.headers,
    });
    expect(swap.statusCode).toBe(200);
    expect(swap.json().balance).toBe(start - 560);
    const [swapPack] = await t.db.select().from(packs).where(eq(packs.id, swap.json().packId));
    expect(swapPack!.rarity).toBe('bronze');
    expect((await t.db.select().from(cards).where(eq(cards.id, slot2!.cardId)))[0]!.inactiveReason).toBe(
      'swapped',
    );
    expect(
      (await app.inject({ method: 'POST', url: `/cards/${slot2!.cardId}/swap`, headers: u.headers })).json()
        .error,
    ).toBe('already_swapped');

    // Insufficient Coins.
    await ledger(
      t.db,
      t.clock.now(),
      u.userId,
      -(await coinBalance(t.db, u.userId)),
      'admin_adjustment',
      'test:drain',
    );
    const poor = await app.inject({
      method: 'POST',
      url: '/shop/buy',
      headers: { ...u.headers, 'idempotency-key': 'req-0003-abc' },
      payload: { item: 'player_pack' },
    });
    expect(poor.json().error).toBe('insufficient_coins');

    // Ledger reconciles to the balance.
    const [sum] = await t.db
      .select({ s: sql<number>`sum(${coinLedger.amount})::int` })
      .from(coinLedger)
      .where(eq(coinLedger.userId, u.userId));
    expect(sum!.s).toBe(await coinBalance(t.db, u.userId));
    const rewards = (await app.inject({ method: 'GET', url: '/rewards', headers: u.headers })).json();
    expect(rewards.coins).toBe(0);
    expect(rewards.shop.map((s: { price: number }) => s.price)).toEqual([100, 60, 400]);

    // Milestones: lift season points past 500 → silver + gold, once.
    await t.db.update(gameweekScores).set({ total: 520 }).where(eq(gameweekScores.userId, u.userId));
    expect(await grantMilestones(t.ctx, [u.userId])).toBe(2);
    expect(await grantMilestones(t.ctx, [u.userId])).toBe(0);
    const ms = await t.db
      .select()
      .from(packs)
      .where(and(eq(packs.userId, u.userId), eq(packs.source, 'milestone')));
    expect(ms.map((p) => p.type).sort()).toEqual(['gold', 'silver']);
    const after = (await app.inject({ method: 'GET', url: '/rewards', headers: u.headers })).json();
    expect(after.milestones.filter((m: { done: boolean }) => m.done)).toHaveLength(2);
    expect(after.nextMilestone.season_points).toBe(750);
    expect(after.nextMilestone.toGo).toBe(230);

    const home = (await app.inject({ method: 'GET', url: '/home', headers: u.headers })).json();
    expect(home.coins).toEqual({ balance: 0, nextPackPrice: 100, toNextPack: 100 });
  });
});
