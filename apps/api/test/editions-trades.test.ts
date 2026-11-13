import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { DAY, HOUR } from '../src/clock.js';
import { cards, editions, gameweeks, packs, squadSlots, trades } from '../src/db/schema.js';
import { tick } from '../src/jobs/tick.js';
import { activateConfigVersion } from '../src/services/config.js';
import { performanceScore } from '../src/services/editions.js';
import { datasetCtx, findPlayers, giveSquad, signUp } from './fixtures.js';

describe('performance score', () => {
  it('rewards goals by position, clean sheets for defenders, and minutes', () => {
    const base = {
      minutes: 90,
      goals: 0,
      assists: 0,
      cleanSheet: false,
      saves: 0,
      yellowCards: 0,
      redCards: 0,
    };
    expect(performanceScore('DEF', { ...base, goals: 1, cleanSheet: true })).toBe(8 + 5 + 2);
    expect(performanceScore('FWD', { ...base, goals: 2 })).toBe(10 + 2);
    expect(performanceScore('GK', { ...base, saves: 7, cleanSheet: true })).toBe(4 + 5 + 2);
    expect(performanceScore('MID', { ...base, minutes: 0, goals: 1 })).toBe(0);
  });
});

describe('Team of the Week editions and trading', () => {
  let t: Awaited<ReturnType<typeof datasetCtx>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => {
    t = await datasetCtx([1, 2]);
    await activateConfigVersion(t.db, 'economy', '0.2');
    app = await buildApp(t.ctx);
  });
  afterAll(() => t.close());

  it('runs end to end', async () => {
    const regs = findPlayers(1, [
      { position: 'GK', where: (m) => m.stats.minutes >= 90 },
      { position: 'DEF', where: (m) => m.stats.minutes >= 90 },
      { position: 'MID', where: (m) => m.stats.minutes >= 90 },
      { position: 'MID', where: (m) => m.stats.minutes >= 90 },
      { position: 'FWD', where: (m) => m.stats.minutes >= 90 },
      { position: 'MID', where: (m) => m.stats.minutes >= 90 },
    ]).map((m) => m.playerId);
    const others = findPlayers(1, [
      { position: 'GK', where: (m) => m.stats.minutes >= 90 && !regs.includes(m.playerId) },
      { position: 'DEF', where: (m) => m.stats.minutes >= 90 && !regs.includes(m.playerId) },
      { position: 'MID', where: (m) => m.stats.minutes >= 90 && !regs.includes(m.playerId) },
      { position: 'MID', where: (m) => m.stats.minutes >= 90 && !regs.includes(m.playerId) },
      { position: 'FWD', where: (m) => m.stats.minutes >= 90 && !regs.includes(m.playerId) },
    ]).map((m) => m.playerId);
    const a = await signUp(app, t, '07700901300', 'Alice');
    const b = await signUp(app, t, '07700901301', 'Ben');
    const c = await signUp(app, t, '07700901302', 'Cat');
    await giveSquad(t.db, a.userId, regs);
    await giveSquad(t.db, b.userId, others);
    await giveSquad(t.db, c.userId, others);
    const league = (
      await app.inject({ method: 'POST', url: '/leagues', headers: a.headers, payload: { name: 'Traders' } })
    ).json();
    await app.inject({
      method: 'POST',
      url: '/leagues/join',
      headers: b.headers,
      payload: { code: league.code },
    });

    // Alice confirms; the others carry over Auto-pick. Play GW1 to the end.
    const [g1] = (await t.db.select().from(gameweeks)).sort((x, y) => x.number - y.number);
    const auto = (
      await app.inject({
        method: 'POST',
        url: '/picks/suggest',
        headers: a.headers,
        payload: { kind: 'auto' },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/picks/${g1!.id}/confirm`,
      headers: a.headers,
      payload: auto.selection,
    });
    t.clock.set(g1!.deadlineAt);
    await tick(t.ctx);
    t.clock.set(g1!.finaliseAt);
    await tick(t.ctx);

    // Edition: best GK, DEF, 2 MIDs, FWD, 50 numbered cards each.
    const eds = await t.db.select().from(editions).where(eq(editions.gameweekId, g1!.id));
    expect(eds).toHaveLength(5);
    expect(eds.every((e) => e.supply === 50 && e.name === 'Team of the Week · GW1')).toBe(true);

    // Top 10% of the week (at least one player, ties included) get a sealed Team of the Week pack.
    const totw = await t.db.select().from(packs).where(eq(packs.type, 'totw'));
    expect(totw.length).toBeGreaterThanOrEqual(1);
    const winner = totw[0]!;
    const headers = [a, b, c].find((u) => u.userId === winner.userId)!.headers;
    const opened = (await app.inject({ method: 'POST', url: `/packs/${winner.id}/open`, headers })).json();
    expect(opened.cards[0].edition).toEqual({ name: 'Team of the Week · GW1', serial: 1, supply: 50 });
    const [card] = await t.db.select().from(cards).where(eq(cards.id, opened.cards[0].cardId));
    expect(card!.serial).toBe(1);
    expect((await t.db.select().from(editions).where(eq(editions.id, card!.editionId!)))[0]!.issued).toBe(1);

    // Supply runs out: a TOTW pack falls back to a Gold pack card.
    for (const e of eds) await t.db.update(editions).set({ issued: e.supply }).where(eq(editions.id, e.id));
    const { grantPack } = await import('../src/services/packs.js');
    const { pack: extra } = await grantPack(
      t.db,
      t.clock.now(),
      c.userId,
      'totw',
      'admin',
      'test:totw-empty',
      null,
      { gameweekId: g1!.id },
    );
    const fallback = (
      await app.inject({ method: 'POST', url: `/packs/${extra.id}/open`, headers: c.headers })
    ).json();
    expect(fallback.cards[0].edition ?? null).toBeNull();

    // Trading: only with league-mates.
    const aCards = await t.db.select().from(cards).where(eq(cards.userId, a.userId));
    const bCards = await t.db.select().from(cards).where(eq(cards.userId, b.userId));
    const cCards = await t.db.select().from(cards).where(eq(cards.userId, c.userId));
    const give = aCards.find((x) => !x.editionId)!;
    const get = bCards[0]!;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/trades',
          headers: c.headers,
          payload: { offeredCardId: cCards[0]!.id, toUserId: a.userId, requestedCardId: give.id },
        })
      ).json().error,
    ).toBe('not_league_mate');
    expect(
      (
        await app.inject({ method: 'GET', url: `/trades/partners/${b.userId}/cards`, headers: a.headers })
      ).json().length,
    ).toBeGreaterThan(0);
    expect((await app.inject({ method: 'GET', url: '/trades/partners', headers: a.headers })).json()).toEqual(
      [{ id: b.userId, name: 'Ben' }],
    );

    const offer = await app.inject({
      method: 'POST',
      url: '/trades',
      headers: a.headers,
      payload: { offeredCardId: give.id, toUserId: b.userId, requestedCardId: get.id },
    });
    expect(offer.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/trades',
          headers: a.headers,
          payload: { offeredCardId: give.id, toUserId: b.userId, requestedCardId: bCards[1]!.id },
        })
      ).json().error,
    ).toBe('already_offered');
    // Only Ben can accept.
    expect(
      (
        await app.inject({ method: 'POST', url: `/trades/${offer.json().id}/accept`, headers: a.headers })
      ).json().error,
    ).toBe('not_yours');
    const screen = (await app.inject({ method: 'GET', url: '/trades', headers: b.headers })).json();
    expect(screen.incoming[0].get.player.name).toBeTruthy();
    const accepted = await app.inject({
      method: 'POST',
      url: `/trades/${offer.json().id}/accept`,
      headers: b.headers,
    });
    expect(accepted.json().status).toBe('accepted');
    expect((await t.db.select().from(cards).where(eq(cards.id, give.id)))[0]!.userId).toBe(b.userId);
    expect((await t.db.select().from(cards).where(eq(cards.id, get.id)))[0]!.userId).toBe(a.userId);
    // Both squads stay complete and only hold cards their owner owns (the gap is auto-filled).
    for (const u of [a, b]) {
      const slots = await t.db
        .select({ slot: squadSlots.slot, owner: cards.userId })
        .from(squadSlots)
        .innerJoin(cards, eq(cards.id, squadSlots.cardId))
        .where(eq(squadSlots.userId, u.userId));
      expect(slots.filter((s) => s.slot < 5)).toHaveLength(5);
      expect(slots.every((s) => s.owner === u.userId)).toBe(true);
    }
    // Alice no longer owns the card she traded.
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/trades',
          headers: a.headers,
          payload: { offeredCardId: give.id, toUserId: b.userId, requestedCardId: bCards[1]!.id },
        })
      ).json().error,
    ).toBe('card_not_owned');

    // Offers expire; decline and cancel are limited to the right side.
    const o2 = (
      await app.inject({
        method: 'POST',
        url: '/trades',
        headers: a.headers,
        payload: { offeredCardId: get.id, toUserId: b.userId, requestedCardId: bCards[1]!.id },
      })
    ).json();
    expect(
      (await app.inject({ method: 'POST', url: `/trades/${o2.id}/decline`, headers: a.headers })).json()
        .error,
    ).toBe('not_yours');
    t.clock.advance(49 * HOUR);
    await tick(t.ctx);
    expect((await t.db.select().from(trades).where(eq(trades.id, o2.id)))[0]!.status).toBe('expired');

    // New accounts can't trade for 7 days.
    const d = await signUp(app, t, '07700901303', 'Dan');
    await app.inject({
      method: 'POST',
      url: '/leagues/join',
      headers: d.headers,
      payload: { code: league.code },
    });
    const dCard = (
      await app.inject({ method: 'GET', url: `/trades/partners/${a.userId}/cards`, headers: d.headers })
    ).json();
    expect(dCard.length).toBeGreaterThan(0);
    await giveSquad(t.db, d.userId, others);
    const dOwn = (await t.db.select().from(cards).where(eq(cards.userId, d.userId)))[0]!;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/trades',
          headers: d.headers,
          payload: { offeredCardId: dOwn.id, toUserId: a.userId, requestedCardId: get.id },
        })
      ).json().error,
    ).toBe('account_too_new');
    t.clock.advance(8 * DAY);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/trades',
          headers: d.headers,
          payload: { offeredCardId: dOwn.id, toUserId: a.userId, requestedCardId: get.id },
        })
      ).statusCode,
    ).toBe(200);
  });
});
