import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { SquadScore } from '@ff/scoring';
import { buildApp } from '../src/app.js';
import { HOUR } from '../src/clock.js';
import { adminAudit, cards, clubs, gameweekScores, gameweeks, packs, players } from '../src/db/schema.js';
import { tick } from '../src/jobs/tick.js';
import { readConfigFile } from '../src/services/config.js';
import { getSquad } from '../src/services/squad.js';
import { datasetCtx, findPlayers, giveSquad, signUp } from './fixtures.js';

process.env.STAFF_TOKENS = 'alice:alice-very-long-staff-token';
const staff = { authorization: 'Bearer alice-very-long-staff-token' };

let t: Awaited<ReturnType<typeof datasetCtx>>;
let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  t = await datasetCtx([1, 2]);
  app = await buildApp(t.ctx);
});
afterAll(() => t.close());

describe('admin console API', () => {
  it('requires a staff token', async () => {
    expect((await app.inject({ method: 'GET', url: '/admin/gameweeks' })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/admin/gameweeks',
          headers: { authorization: 'Bearer nope' },
        })
      ).statusCode,
    ).toBe(401);
    const u = await signUp(app, t, '07700901000');
    expect(
      (await app.inject({ method: 'GET', url: '/admin/gameweeks', headers: u.headers })).statusCode,
    ).toBe(401);
  });

  it('handles every edge case without a developer', async () => {
    const regs = findPlayers(1, [
      { position: 'GK', where: (m) => m.stats.minutes >= 90 },
      { position: 'DEF', where: (m) => m.stats.minutes >= 90 },
      { position: 'MID', where: (m) => m.stats.minutes >= 90 },
      { position: 'MID', where: (m) => m.stats.minutes >= 90 },
      { position: 'FWD', where: (m) => m.stats.minutes >= 90 },
      { position: 'MID', where: (m) => m.stats.minutes >= 90 },
    ]);
    const u = await signUp(app, t, '07700901001', 'Support Case');
    await giveSquad(
      t.db,
      u.userId,
      regs.map((m) => m.playerId),
      'gold',
    );
    const [g1, g2] = (await t.db.select().from(gameweeks)).sort((a, b) => a.number - b.number);

    // Lock and play GW1, then void the striker's match mid-gameweek.
    t.clock.set(g1!.deadlineAt);
    await tick(t.ctx);
    t.clock.set(new Date(g1!.lastKickoffAt.getTime() + 3 * HOUR));
    await tick(t.ctx);
    const fx = (
      await app.inject({ method: 'GET', url: `/admin/gameweeks/${g1!.id}/fixtures`, headers: staff })
    ).json();
    const strikerFx = fx.find((f: { providerRef: string }) => f.providerRef === `fpl:f${regs[4]!.fixtureId}`);
    const v = await app.inject({
      method: 'POST',
      url: `/admin/fixtures/${strikerFx.id}/void`,
      headers: staff,
      payload: { voided: true, reason: 'Abandoned (floodlight failure)' },
    });
    expect(v.json().rescored).toBeGreaterThan(0);
    const [score] = await t.db.select().from(gameweekScores).where(eq(gameweekScores.userId, u.userId));
    const b = score!.breakdown as SquadScore;
    expect(b.slots[4]!.lines.every((l) => l.voidReason === 'match_void')).toBe(true);
    expect(b.slots[5]!.role).toBe('sub_in');

    // Finalise; afterwards nothing can change the gameweek.
    t.clock.set(g1!.finaliseAt);
    await tick(t.ctx);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/admin/fixtures/${strikerFx.id}/void`,
          headers: staff,
          payload: { voided: false, reason: 'try to undo' },
        })
      ).json().error,
    ).toBe('finalised');
    expect(
      (await app.inject({ method: 'POST', url: `/admin/gameweeks/${g1!.id}/rescore`, headers: staff })).json()
        .error,
    ).toBe('finalised');

    // Transfers and leaving the league.
    const squad = await getSquad(t.db, u.userId);
    const other = (await t.db.select().from(clubs)).find((c) => c.id !== squad[0]!.clubId)!;
    const tr = await app.inject({
      method: 'POST',
      url: '/admin/moves',
      headers: staff,
      payload: { playerId: squad[0]!.playerId, kind: 'transfer', toClubId: other.id },
    });
    expect(tr.json().effectiveGameweekId).toBe(g2!.id);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/admin/moves',
          headers: staff,
          payload: { playerId: squad[1]!.playerId, kind: 'retired' },
        })
      ).statusCode,
    ).toBe(200);
    t.clock.set(g2!.deadlineAt);
    expect(
      (await app.inject({ method: 'POST', url: '/admin/moves/process', headers: staff })).json().changes,
    ).toBeGreaterThanOrEqual(2);
    expect((await t.db.select().from(players).where(eq(players.id, squad[0]!.playerId)))[0]!.clubId).toBe(
      other.id,
    );
    expect((await t.db.select().from(cards).where(eq(cards.id, squad[1]!.cardId)))[0]!.active).toBe(false);

    // Relegation and promotion.
    const rel = await app.inject({
      method: 'POST',
      url: `/admin/clubs/${squad[2]!.clubId}/relegate`,
      headers: staff,
    });
    expect(rel.json().cards).toBeGreaterThanOrEqual(1);
    await app.inject({ method: 'POST', url: `/admin/clubs/${squad[2]!.clubId}/promote`, headers: staff });
    expect((await t.db.select().from(clubs).where(eq(clubs.id, squad[2]!.clubId!)))[0]!.inLeague).toBe(true);

    // Ratings.
    const pr = await app.inject({
      method: 'PUT',
      url: `/admin/players/${squad[3]!.playerId}/rating`,
      headers: staff,
      payload: { rating: 77, applyToCards: true },
    });
    expect(pr.json().cardsUpdated).toBeGreaterThanOrEqual(1);
    expect((await t.db.select().from(cards).where(eq(cards.id, squad[3]!.cardId)))[0]!.rating).toBe(77);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/admin/cards/${squad[3]!.cardId}/rating`,
          headers: staff,
          payload: { rating: 120 },
        })
      ).statusCode,
    ).toBe(400);

    // Config versions: upload (validated), activate, list.
    const bad = await app.inject({
      method: 'POST',
      url: '/admin/config',
      headers: staff,
      payload: { kind: 'economy', body: { version: 'x' } },
    });
    expect(bad.json().error).toBe('invalid_config');
    const eco = readConfigFile('economy.v0.1.json') as Record<string, unknown> & {
      season_milestones: { season_points: number }[];
    };
    const next = {
      ...eco,
      version: '0.9-test',
      season_milestones: [200, 400, 550, 750].map((p, i) => ({
        season_points: p,
        reward: eco.season_milestones[i]!['reward' as never],
      })),
    };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/admin/config',
          headers: staff,
          payload: { kind: 'economy', body: next },
        })
      ).statusCode,
    ).toBe(200);
    await app.inject({
      method: 'POST',
      url: '/admin/config/activate',
      headers: staff,
      payload: { kind: 'economy', version: '0.9-test' },
    });
    const rewards = (await app.inject({ method: 'GET', url: '/rewards', headers: u.headers })).json();
    expect(rewards.milestones[0].season_points).toBe(200);

    // Pack-open logs with seed and odds version.
    const [p0] = await t.db.select().from(packs).where(eq(packs.userId, u.userId));
    await app.inject({ method: 'POST', url: `/packs/${p0!.id}/open`, headers: u.headers });
    const logs = (
      await app.inject({ method: 'GET', url: `/admin/packs?userId=${u.userId}`, headers: staff })
    ).json();
    expect(logs[0].seed).toBeTruthy();
    expect(logs[0].oddsVersion).toBe('0.1');

    // User lookup by name and by phone; ledger + breakdown; coin adjustment.
    expect(
      (await app.inject({ method: 'GET', url: '/admin/users?q=Support', headers: staff })).json()[0].id,
    ).toBe(u.userId);
    expect(
      (await app.inject({ method: 'GET', url: '/admin/users?q=07700901001', headers: staff })).json()[0].id,
    ).toBe(u.userId);
    const adj = await app.inject({
      method: 'POST',
      url: `/admin/users/${u.userId}/coins`,
      headers: staff,
      payload: { amount: 25, reason: 'Compensation for outage' },
    });
    const detail = (
      await app.inject({ method: 'GET', url: `/admin/users/${u.userId}`, headers: staff })
    ).json();
    expect(detail.balance).toBe(adj.json().balance);
    expect(detail.ledgerReconciles).toBe(true);
    expect(detail.scores[0].breakdown.slots).toBeTruthy();
    expect(detail.profile.phoneHash).toBeUndefined();

    // GDPR erasure.
    await app.inject({ method: 'POST', url: `/admin/users/${u.userId}/delete`, headers: staff });
    expect((await app.inject({ method: 'GET', url: '/me', headers: u.headers })).statusCode).toBe(401);

    const auditRows = await t.db.select().from(adminAudit);
    expect(new Set(auditRows.map((a) => a.action))).toEqual(
      new Set([
        'fixture.void',
        'move.record',
        'move.process',
        'club.relegate',
        'club.promote',
        'player.rating',
        'config.upload',
        'config.activate',
        'user.coins',
        'user.delete',
      ]),
    );
    expect(auditRows.every((a) => a.staff === 'alice')).toBe(true);
  });
});
