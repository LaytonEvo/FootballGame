import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { gameweekScores, gameweeks } from '../src/db/schema.js';
import { tick } from '../src/jobs/tick.js';
import { rankStandings } from '../src/services/leagues.js';
import { datasetCtx, findPlayers, giveSquad, signUp } from './fixtures.js';

describe('ranking', () => {
  it('orders by points, then most landed, then fewest picked; exact ties share a rank', () => {
    const r = rankStandings([
      { userId: 'a', name: 'A', points: 50, landed: 4, picked: 10 },
      { userId: 'b', name: 'B', points: 50, landed: 5, picked: 10 },
      { userId: 'c', name: 'C', points: 50, landed: 5, picked: 8 },
      { userId: 'd', name: 'D', points: 60, landed: 1, picked: 10 },
      { userId: 'e', name: 'E', points: 50, landed: 4, picked: 10 },
    ]);
    expect(r.map((x) => `${x.userId}${x.rank}`)).toEqual(['d1', 'c2', 'b3', 'a4', 'e4']);
  });
});

describe('mini-leagues', () => {
  let t: Awaited<ReturnType<typeof datasetCtx>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => {
    t = await datasetCtx([1, 2]);
    app = await buildApp(t.ctx);
  });
  afterAll(() => t.close());

  it('create, invite by link, join, and correct tables after replayed gameweeks', async () => {
    const regulars = findPlayers(1, [
      { position: 'GK', where: (m) => m.stats.minutes >= 90 },
      { position: 'DEF', where: (m) => m.stats.minutes >= 90 },
      { position: 'MID', where: (m) => m.stats.minutes >= 90 },
      { position: 'MID', where: (m) => m.stats.minutes >= 90 },
      { position: 'FWD', where: (m) => m.stats.minutes >= 90 },
    ]).map((m) => m.playerId);
    const owner = await signUp(app, t, '07700900700', 'Owner');
    const friend = await signUp(app, t, '07700900701', 'Friend');
    const outsider = await signUp(app, t, '07700900702', 'Outsider');
    for (const u of [owner, friend, outsider]) await giveSquad(t.db, u.userId, regulars);

    const created = await app.inject({
      method: 'POST',
      url: '/leagues',
      headers: owner.headers,
      payload: { name: 'Office League' },
    });
    expect(created.statusCode).toBe(200);
    const league = created.json();
    expect(league.url).toBe(`https://fantasyfive.test/join/${league.code}`);
    expect(league.appUrl).toBe(`fantasyfive://join/${league.code}`);

    const preview = await app.inject({ method: 'GET', url: `/invites/${league.code}` });
    expect(preview.json()).toEqual({ name: 'Office League', members: 1 });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/leagues/join',
          headers: friend.headers,
          payload: { code: league.code.toLowerCase() },
        })
      ).statusCode,
    ).toBe(200);
    await app.inject({
      method: 'POST',
      url: '/leagues/join',
      headers: friend.headers,
      payload: { code: league.code },
    }); // idempotent
    expect(
      (await app.inject({ method: 'GET', url: `/leagues/${league.id}`, headers: outsider.headers }))
        .statusCode,
    ).toBe(403);

    // GW1: owner picks bold long shots, friend auto-picks, outsider auto-picks.
    const [g1, g2] = (await t.db.select().from(gameweeks)).sort((a, b) => a.number - b.number);
    const auto = (h: Record<string, string>) =>
      app
        .inject({ method: 'POST', url: '/picks/suggest', headers: h, payload: { kind: 'auto' } })
        .then((r) => r.json().selection);
    await app.inject({
      method: 'POST',
      url: `/picks/${g1!.id}/confirm`,
      headers: friend.headers,
      payload: await auto(friend.headers),
    });
    const ownerSel = {
      actions: [['penalty_save'], ['goal'], ['assist'], ['assist'], ['hat_trick']],
      captain: 4,
      bold: { slot: 4, actionId: 'hat_trick' },
    };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/picks/${g1!.id}/confirm`,
          headers: owner.headers,
          payload: ownerSel,
        })
      ).statusCode,
    ).toBe(200);
    t.clock.set(g1!.deadlineAt);
    await tick(t.ctx);
    t.clock.set(g1!.finaliseAt);
    await tick(t.ctx);

    const scores = new Map(
      (await t.db.select().from(gameweekScores).where(eq(gameweekScores.gameweekId, g1!.id))).map((s) => [
        s.userId,
        s,
      ]),
    );
    const season = (
      await app.inject({ method: 'GET', url: `/leagues/${league.id}`, headers: owner.headers })
    ).json();
    expect(season.size).toBe(2);
    for (const r of season.rows) expect(r.points).toBe(scores.get(r.userId)!.total);
    expect(season.rows[0].points).toBeGreaterThanOrEqual(season.rows[1].points);
    const week = (
      await app.inject({
        method: 'GET',
        url: `/leagues/${league.id}?view=week&gameweekId=${g1!.id}`,
        headers: owner.headers,
      })
    ).json();
    expect(week.rows.map((r: { userId: string }) => r.userId)).toEqual(
      season.rows.map((r: { userId: string }) => r.userId),
    );

    const global = (
      await app.inject({ method: 'GET', url: '/leagues/global', headers: outsider.headers })
    ).json();
    expect(global.size).toBe(3);
    expect(global.me.userId).toBe(outsider.userId);

    // GW2 (carried over for everyone): movement arrows compare with the table before GW2.
    t.clock.set(g2!.deadlineAt);
    await tick(t.ctx);
    t.clock.set(g2!.finaliseAt);
    await tick(t.ctx);
    const after = (
      await app.inject({ method: 'GET', url: `/leagues/${league.id}`, headers: owner.headers })
    ).json();
    for (const r of after.rows) {
      const prev = season.rows.find((x: { userId: string }) => x.userId === r.userId);
      expect(r.previousRank).toBe(prev.rank);
    }
    const totals = await t.db.select().from(gameweekScores).where(eq(gameweekScores.userId, owner.userId));
    expect(after.rows.find((r: { userId: string }) => r.userId === owner.userId).points).toBe(
      totals.reduce((s, x) => s + x.total, 0),
    );

    const home = (await app.inject({ method: 'GET', url: '/home', headers: friend.headers })).json();
    expect(home.league.name).toBe('Office League');
    expect(home.league.size).toBe(2);

    const mine = (
      await app.inject({ method: 'GET', url: `/me/season?leagueId=${league.id}`, headers: owner.headers })
    ).json();
    expect(mine.weeks.filter((w: { points: number | null }) => w.points !== null)).toHaveLength(2);
    expect(mine.total).toBe(totals.reduce((s, x) => s + x.total, 0));

    const list = (await app.inject({ method: 'GET', url: '/leagues', headers: friend.headers })).json();
    expect(list).toHaveLength(1);
  });
});
