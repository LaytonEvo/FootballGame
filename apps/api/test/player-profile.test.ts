import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { cards, gameweeks, players } from '../src/db/schema.js';
import { tick } from '../src/jobs/tick.js';
import { datasetCtx, ds, findPlayers, playerIdFor, signUp } from './fixtures.js';

let t: Awaited<ReturnType<typeof datasetCtx>>;
let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  t = await datasetCtx([1, 2, 3]);
  app = await buildApp(t.ctx);
  // Play GW1 and GW2 to the end.
  const gws = (await t.db.select().from(gameweeks)).sort((a, b) => a.number - b.number);
  for (const gw of gws.slice(0, 2)) {
    t.clock.set(gw.deadlineAt);
    await tick(t.ctx);
    t.clock.set(gw.finaliseAt);
    await tick(t.ctx);
  }
});
afterAll(() => t.close());

describe('player profile', () => {
  it('shows season totals, recent matches, action hit rates and next fixtures', async () => {
    const u = await signUp(app, t, '07700901100');
    const [fwd] = findPlayers(1, [{ position: 'FWD', where: (m) => m.stats.goals >= 1 }]);
    const id = await playerIdFor(t.db, fwd!.playerId);
    const r = await app.inject({ method: 'GET', url: `/players/${id}`, headers: u.headers });
    expect(r.statusCode).toBe(200);
    const p = r.json();
    const mine = ds.playerMatches.filter((m) => m.playerId === fwd!.playerId && m.gameweek <= 2);
    expect(p.player.name).toBe(fwd!.name);
    expect(p.season.goals).toBe(mine.reduce((s, m) => s + m.stats.goals, 0));
    expect(p.season.minutes).toBe(mine.reduce((s, m) => s + m.stats.minutes, 0));
    expect(p.recent[0].gameweek).toBe(2);
    expect(p.recent[0].opponent).toMatch(/^v [A-Z]{3} \((H|A)\)$/);
    const goal = p.actions.find((a: { id: string }) => a.id === 'goal');
    expect(goal.season.of).toBe(2);
    expect(goal.season.hits).toBeGreaterThanOrEqual(1);
    expect(p.upcoming[0].gameweek).toBe(3);
    expect(p.myCards).toEqual([]);
  });
});

describe('pack pool', () => {
  it('only deals players who are getting minutes', async () => {
    const u = await signUp(app, t, '07700901101');
    await app.inject({ method: 'POST', url: `/packs/${u.starterPackId}/open`, headers: u.headers });
    for (let i = 0; i < 6; i++) {
      const { grantPack } = await import('../src/services/packs.js');
      const { pack } = await grantPack(t.db, t.clock.now(), u.userId, 'squad', 'admin', `test:sq${i}`);
      await app.inject({ method: 'POST', url: `/packs/${pack.id}/open`, headers: u.headers });
    }
    const owned = await t.db
      .select({ ref: players.providerRef })
      .from(cards)
      .innerJoin(players, eq(players.id, cards.playerId))
      .where(eq(cards.userId, u.userId));
    const elements = owned.map((o) => Number(o.ref.replace('fpl:p', '')));
    // 180 minutes over 6 gameweeks, scaled to the 2 played → at least 60 minutes in GW1-2.
    for (const e of elements) {
      const mins = ds.playerMatches
        .filter((m) => m.playerId === e && m.gameweek <= 2)
        .reduce((s, m) => s + m.stats.minutes, 0);
      expect(mins).toBeGreaterThanOrEqual(60);
    }
    expect(elements.length).toBeGreaterThanOrEqual(20); // duplicates level up instead of adding a card
  });
});
