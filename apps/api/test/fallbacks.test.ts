import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { PlayerMatchStats } from '@ff/shared';
import { buildApp } from '../src/app.js';
import { gameweeks, selections } from '../src/db/schema.js';
import { tick } from '../src/jobs/tick.js';
import { availabilityWarning } from '../src/services/picks.js';
import type { StoredSelection } from '../src/services/selection-body.js';
import { getSquad } from '../src/services/squad.js';
import { datasetCtx, findPlayers, giveSquad, signUp } from './fixtures.js';

const m = (minutes: number) => [{ minutes } as PlayerMatchStats];

describe('availability warning', () => {
  it('flags no match, no minutes and few minutes', () => {
    expect(availabilityWarning([m(90), m(90)], false)).toBe('No match this gameweek');
    expect(availabilityWarning([m(0), m(0), m(90)], true)).toBe('0 mins in last 2 gameweeks');
    expect(availabilityWarning([m(0)], true)).toBe('0 mins in last gameweek');
    expect(availabilityWarning([m(10), m(25)], true)).toBe('Only 35′ in last 2 gameweeks');
    expect(availabilityWarning([m(90), m(10)], true)).toBeNull();
    expect(availabilityWarning([], true)).toBeNull();
  });
});

describe('swap with sub and the pick-screen nudge', () => {
  let t: Awaited<ReturnType<typeof datasetCtx>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => {
    t = await datasetCtx([1, 2]);
    app = await buildApp(t.ctx);
  });
  afterAll(() => t.close());

  it('flags a starter who did not play, and swapping keeps everyone’s actions', async () => {
    const regs = findPlayers(1, [
      { position: 'GK', where: (x) => x.stats.minutes >= 90 },
      { position: 'DEF', where: (x) => x.stats.minutes >= 90 },
      { position: 'MID', where: (x) => x.stats.minutes === 0 && x.starts === 0 }, // benched in GW1
      { position: 'MID', where: (x) => x.stats.minutes >= 90 },
      { position: 'FWD', where: (x) => x.stats.minutes >= 90 },
      { position: 'MID', where: (x) => x.stats.minutes >= 90 },
    ]);
    const u = await signUp(app, t, '07700901200');
    await giveSquad(
      t.db,
      u.userId,
      regs.map((r) => r.playerId),
    );
    const [g1, g2] = (await t.db.select().from(gameweeks)).sort((a, b) => a.number - b.number);
    t.clock.set(g1!.deadlineAt);
    await tick(t.ctx);
    t.clock.set(g1!.finaliseAt);
    await tick(t.ctx);

    const screen = (await app.inject({ method: 'GET', url: '/picks', headers: u.headers })).json();
    expect(screen.gameweek.id).toBe(g2!.id);
    expect(screen.slots[2].warning).toBe('0 mins in last gameweek');
    expect(screen.slots[3].warning).toBeNull();

    const sel = {
      actions: [['saves_3plus'], ['clean_sheet'], ['assist'], ['plays_90'], ['goal'], ['goal_involvement']],
      captain: 2,
      bold: { slot: 2, actionId: 'assist' },
    };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/picks/${g2!.id}/confirm`,
          headers: u.headers,
          payload: sel,
        })
      ).statusCode,
    ).toBe(200);

    expect(
      (
        await app.inject({ method: 'POST', url: '/picks/swap-sub', headers: u.headers, payload: { slot: 0 } })
      ).json().error,
    ).toBe('wrong_position');
    const r = await app.inject({
      method: 'POST',
      url: '/picks/swap-sub',
      headers: u.headers,
      payload: { slot: 2 },
    });
    expect(r.statusCode).toBe(200);
    const squad = await getSquad(t.db, u.userId);
    expect(squad.find((s) => s.slot === 2)!.playerId).not.toBe(squad.find((s) => s.slot === 5)!.playerId);

    const [saved] = await t.db
      .select()
      .from(selections)
      .where(and(eq(selections.userId, u.userId), eq(selections.gameweekId, g2!.id)));
    const body = saved!.body as StoredSelection;
    // Actions follow the players; captaincy stays with the slot; bold follows the player to the bench.
    expect(body.starters[2]!.actions).toEqual(['goal_involvement']);
    expect(body.sub!.actions).toEqual(['assist']);
    expect(body.captain).toBe(2);
    expect(body.bold).toEqual({ slot: 5, actionId: 'assist' });
    expect(saved!.confirmedAt).toBeTruthy();
  });
});
