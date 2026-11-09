import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { MINUTE } from '../src/clock.js';
import { cards, clubs, gameweeks, packs, players } from '../src/db/schema.js';
import { tick } from '../src/jobs/tick.js';
import { processDueMoves, recordMove, relegateClub } from '../src/services/moves.js';
import { getSquad } from '../src/services/squad.js';
import { datasetCtx, signUp } from './fixtures.js';

let t: Awaited<ReturnType<typeof datasetCtx>>;
let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  t = await datasetCtx([1, 2]);
  app = await buildApp(t.ctx);
});
afterAll(() => t.close());

async function newUser(phone: string) {
  const u = await signUp(app, t, phone);
  await app.inject({ method: 'POST', url: `/packs/${u.starterPackId}/open`, headers: u.headers });
  return u;
}
const gw = async (n: number) => (await t.db.select().from(gameweeks).where(eq(gameweeks.number, n)))[0]!;

describe('transfers and leaving the league', () => {
  it('a transfer between league clubs: card follows the player from the next deadline', async () => {
    const u = await newUser('07700900400');
    const fwd = (await getSquad(t.db, u.userId))[4]!;
    const otherClub = (await t.db.select().from(clubs)).find((c) => c.id !== fwd.clubId)!;
    const gw1 = await gw(1);
    t.clock.set(new Date(gw1.deadlineAt.getTime() - 60 * MINUTE));
    await recordMove(t.db, {
      ref: 'test:transfer',
      playerId: fwd.playerId,
      kind: 'transfer',
      toClubId: otherClub.id,
      registeredAt: t.clock.now(),
    });
    expect(await processDueMoves(t.ctx)).toEqual([]); // not before the deadline
    expect((await getSquad(t.db, u.userId))[4]!.clubId).toBe(fwd.clubId);
    t.clock.set(gw1.deadlineAt);
    const r = await tick(t.ctx);
    expect(r.moves.some((m) => m.kind === 'transfer' && m.cardId === fwd.cardId)).toBe(true);
    const after = (await getSquad(t.db, u.userId))[4]!;
    expect(after.clubId).toBe(otherClub.id);
    expect(after.active).toBe(true);
    expect(after.cardId).toBe(fwd.cardId);
  });

  it('leaving the league: card inactive, out of the five, free same-rarity swap pack; returning reactivates', async () => {
    const u = await newUser('07700900401');
    const mid = (await getSquad(t.db, u.userId))[2]!;
    // A spare MID in the collection so the squad can be auto-filled.
    const spare = (await t.db.select().from(players).where(eq(players.position, 'MID'))).find(
      (p) => p.clubId && p.id !== mid.playerId && p.rating < 60,
    )!;
    await t.db
      .insert(cards)
      .values({
        id: 'spare-card',
        userId: u.userId,
        playerId: spare.id,
        rarity: 'bronze',
        rating: spare.rating,
        clubAtOpeningId: spare.clubId,
      });

    const gw2 = await gw(2);
    t.clock.set(new Date(gw2.deadlineAt.getTime() - 24 * 60 * MINUTE));
    await recordMove(t.db, {
      ref: 'test:left',
      playerId: mid.playerId,
      kind: 'left_league',
      toClubId: null,
      registeredAt: t.clock.now(),
    });
    t.clock.set(gw2.deadlineAt);
    await processDueMoves(t.ctx);

    const [card] = await t.db.select().from(cards).where(eq(cards.id, mid.cardId));
    expect(card!.active).toBe(false);
    const squad = await getSquad(t.db, u.userId);
    expect(squad.find((s) => s.cardId === mid.cardId)).toBeUndefined();
    expect(squad.find((s) => s.slot === 2)?.cardId).toBe('spare-card'); // auto-filled
    const comp = await t.db
      .select()
      .from(packs)
      .where(and(eq(packs.userId, u.userId), eq(packs.source, 'compensation')));
    expect(comp).toHaveLength(1);
    expect(comp[0]!.type).toBe('swap');
    expect(comp[0]!.rarity).toBe(mid.rarity);

    // An inactive card cannot go back into the five.
    const bad = await app.inject({
      method: 'POST',
      url: '/squad/place',
      headers: u.headers,
      payload: { cardId: mid.cardId, slot: 2 },
    });
    expect(bad.json().details.some((d: { code: string }) => d.code === 'inactive')).toBe(true);

    // Returns to the league: reactivates; the owner keeps the swap pack.
    await recordMove(t.db, {
      ref: 'test:back',
      playerId: mid.playerId,
      kind: 'returned',
      toClubId: mid.clubId,
      registeredAt: t.clock.now(),
    });
    t.clock.advance(365 * 24 * 60 * MINUTE); // past every deadline
    await processDueMoves(t.ctx);
    expect((await t.db.select().from(cards).where(eq(cards.id, mid.cardId)))[0]!.active).toBe(true);
    expect(
      await t.db
        .select()
        .from(packs)
        .where(and(eq(packs.userId, u.userId), eq(packs.source, 'compensation'))),
    ).toHaveLength(1);
  });

  it('relegation: every card of the club goes inactive with one swap pack per card, exactly once', async () => {
    const u = await newUser('07700900402');
    const gk = (await getSquad(t.db, u.userId))[0]!;
    const before = await t.db
      .select()
      .from(cards)
      .where(and(eq(cards.playerId, gk.playerId), eq(cards.active, true)));
    const first = await relegateClub(t.ctx, gk.clubId!);
    expect(first.filter((c) => c.cardId === gk.cardId)).toHaveLength(1);
    expect(first.length).toBeGreaterThanOrEqual(before.length);
    const again = await relegateClub(t.ctx, gk.clubId!);
    expect(again).toEqual([]);
    const comp = await t.db
      .select()
      .from(packs)
      .where(and(eq(packs.userId, u.userId), eq(packs.source, 'compensation')));
    expect(comp.filter((p) => p.grantKey.endsWith(gk.cardId))).toHaveLength(1);
    const [club] = await t.db.select().from(clubs).where(eq(clubs.id, gk.clubId!));
    expect(club!.inLeague).toBe(false);
  });
});
