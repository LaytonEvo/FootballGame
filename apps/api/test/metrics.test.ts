import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asc } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { gameweeks } from '../src/db/schema.js';
import { tick } from '../src/jobs/tick.js';
import type { MetricsReport } from '../src/services/metrics.js';
import { median } from '../src/services/metrics.js';
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

const squad = () =>
  findPlayers(1, [
    { position: 'GK' },
    { position: 'DEF' },
    { position: 'MID' },
    { position: 'MID' },
    { position: 'FWD' },
  ]).map((m) => m.playerId);

type User = Awaited<ReturnType<typeof signUp>>;
async function pick(u: User, gameweekId: string, thinkMs: number[]) {
  // Each entry is time spent before a (re)load of the picks screen or the final confirm.
  for (const ms of thinkMs) {
    await app.inject({ method: 'GET', url: `/picks?gameweekId=${gameweekId}`, headers: u.headers });
    t.clock.advance(ms);
  }
  const auto = (
    await app.inject({ method: 'POST', url: '/picks/suggest', headers: u.headers, payload: { kind: 'auto' } })
  ).json();
  const r = await app.inject({
    method: 'POST',
    url: `/picks/${gameweekId}/confirm`,
    headers: u.headers,
    payload: auto.selection,
  });
  expect(r.statusCode).toBe(200);
}

describe('test metrics dashboard', () => {
  it('is staff only', async () => {
    expect((await app.inject({ method: 'GET', url: '/admin/metrics' })).statusCode).toBe(401);
  });

  it('reports no data before anyone plays', async () => {
    const m = (
      await app.inject({ method: 'GET', url: '/admin/metrics', headers: staff })
    ).json() as MetricsReport;
    expect(m.metrics).toHaveLength(6);
    expect(m.metrics.every((x) => x.status === 'no_data')).toBe(true);
  });

  it('computes all six metrics from a replayed fortnight', async () => {
    const [gw1, gw2] = await t.db.select().from(gameweeks).orderBy(asc(gameweeks.number));
    const a = await signUp(app, t, '07700900901', 'Ann');
    const b = await signUp(app, t, '07700900902', 'Ben');
    await signUp(app, t, '07700900903', 'Cat'); // signs up, never plays
    for (const u of [a, b]) await giveSquad(t.db, u.userId, squad(), 'bronze');

    // GW1: Ann takes 30s, Ben 90s (both measured from account creation too).
    await pick(a, gw1!.id, [30_000]);
    await pick(b, gw1!.id, [90_000]);

    // Ann makes a league, Ben joins by invite.
    const league = (
      await app.inject({ method: 'POST', url: '/leagues', headers: a.headers, payload: { name: 'Pub' } })
    ).json();
    await app.inject({
      method: 'POST',
      url: '/leagues/join',
      headers: b.headers,
      payload: { code: league.code },
    });

    t.clock.set(gw1!.deadlineAt);
    await tick(t.ctx);
    t.clock.set(gw1!.finaliseAt);
    await tick(t.ctx);
    await app.inject({
      method: 'POST',
      url: `/recap/${gw1!.id}/shared`,
      headers: a.headers,
      payload: { format: 'story' },
    });

    // GW2: only Ann returns. She reloads the screen once; time counts from her first open (20s + 20s).
    await pick(a, gw2!.id, [20_000, 20_000]);

    const m = (
      await app.inject({ method: 'GET', url: '/admin/metrics', headers: staff })
    ).json() as MetricsReport;
    const by = Object.fromEntries(m.metrics.map((x) => [x.key, x]));

    // Ann 30s, Ben 30s + 90s = 120s after sign-up → median 75s.
    expect(by.install_to_first_lock).toMatchObject({
      value: 75,
      sample: 2,
      status: 'met',
      display: '1m 15s',
    });
    expect(by.pick_time).toMatchObject({ value: 40, sample: 1, status: 'met' });
    expect(by.retention).toMatchObject({ value: 50, sample: 2, status: 'no_data', display: '50% (week 2)' });
    expect(by.league_membership).toMatchObject({ value: 100, sample: 2, status: 'met' });
    expect(by.recap_shares).toMatchObject({ value: 50, status: 'met' });
    expect(by.invites).toMatchObject({ value: 0.5, status: 'met' });

    expect(m.activePlayers).toBe(2);
    expect(m.retention.map((r) => r.active)).toEqual([2, 1]);
    expect(m.funnel[0]).toEqual({ step: 'Accounts created', users: 3 });
    expect(m.funnel.find((f) => f.step === 'Confirmed actions')!.users).toBe(2);
    expect(m.weekly).toEqual([
      { gameweek: gw1!.number, players: 2, medianPickSeconds: 60, shares: 1 },
      { gameweek: gw2!.number, players: 1, medianPickSeconds: 40, shares: 0 },
    ]);
  });

  it('median handles odd and even lengths', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});
