import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { MINUTE } from '../src/clock.js';
import { analyticsEvents, gameweeks, packs, selections } from '../src/db/schema.js';
import { tick } from '../src/jobs/tick.js';
import type { StoredSelection } from '../src/services/selection-body.js';
import { datasetCtx, signUp } from './fixtures.js';

let t: Awaited<ReturnType<typeof datasetCtx>>;
let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  t = await datasetCtx([1, 2]);
  app = await buildApp(t.ctx);
});
afterAll(() => t.close());

const gw = async (n: number) => (await t.db.select().from(gameweeks).where(eq(gameweeks.number, n)))[0]!;

async function player(phone: string) {
  const u = await signUp(app, t, phone);
  await app.inject({ method: 'POST', url: `/packs/${u.starterPackId}/open`, headers: u.headers });
  return u;
}

describe('pick screen', () => {
  it('shows each slot with fixture context, tiers and points', async () => {
    const u = await player('07700900500');
    const res = await app.inject({ method: 'GET', url: '/picks', headers: u.headers });
    expect(res.statusCode).toBe(200);
    const s = res.json();
    expect(s.gameweek.number).toBe(1);
    expect(s.locked).toBe(false);
    expect(s.slots).toHaveLength(5);
    expect(s.slots[0].fixtureLabel).toMatch(/^v [A-Z]{3} \((H|A)\)$/);
    const fwdActions = s.slots[4].actions.map((a: { id: string }) => a.id);
    expect(fwdActions).toContain('goal');
    expect(fwdActions).not.toContain('tackles_3plus'); // advanced feed hidden in MVP
    expect(s.slots[4].actions.find((a: { id: string }) => a.id === 'goal').tierLabel).toBe('Possible');
    expect(s.hasLastWeek).toBe(false);
  });
});

describe('confirming actions', () => {
  it('auto-pick → confirm in one round-trip each, unlocks the weekly pack once, editable until the deadline', async () => {
    const u = await player('07700900501');
    const g1 = await gw(1);
    await app.inject({ method: 'GET', url: '/picks', headers: u.headers });
    const auto = (
      await app.inject({
        method: 'POST',
        url: '/picks/suggest',
        headers: u.headers,
        payload: { kind: 'auto' },
      })
    ).json();
    expect(auto.selection.actions.every((a: string[]) => a.length === 2)).toBe(true);
    expect(auto.selection.captain).not.toBeNull();

    const sel = { ...auto.selection, bold: { slot: 4, actionId: auto.selection.actions[4][0] } };
    const c1 = await app.inject({
      method: 'POST',
      url: `/picks/${g1.id}/confirm`,
      headers: u.headers,
      payload: sel,
    });
    expect(c1.statusCode).toBe(200);
    expect(c1.json().weeklyPack).toBeTruthy();
    const c2 = await app.inject({
      method: 'POST',
      url: `/picks/${g1.id}/confirm`,
      headers: u.headers,
      payload: { ...sel, captain: 0 },
    });
    expect(c2.json().weeklyPack).toBeNull();
    const weekly = await t.db
      .select()
      .from(packs)
      .where(and(eq(packs.userId, u.userId), eq(packs.source, 'weekly_free')));
    expect(weekly).toHaveLength(1);

    const screen = (await app.inject({ method: 'GET', url: '/picks', headers: u.headers })).json();
    expect(screen.selection.captain).toBe(0);
    expect(screen.confirmedAt).toBeTruthy();

    const ev = await t.db
      .select()
      .from(analyticsEvents)
      .where(and(eq(analyticsEvents.userId, u.userId), eq(analyticsEvents.name, 'actions_confirmed')));
    expect((ev[0]!.props as { pickMs: number }).pickMs).toBeGreaterThanOrEqual(0);
  });

  it('rejects invalid selections with reasons', async () => {
    const u = await player('07700900502');
    const g1 = await gw(1);
    const bad = {
      actions: [['saves_3plus', 'saves_5plus'], ['clean_sheet'], ['yellow_card'], ['yellow_card'], ['goal']],
      captain: 4,
      bold: null,
    };
    const r = await app.inject({
      method: 'POST',
      url: `/picks/${g1.id}/confirm`,
      headers: u.headers,
      payload: bad,
    });
    expect(r.statusCode).toBe(400);
    const codes = r.json().details.map((d: { code: string }) => d.code);
    expect(codes).toEqual(expect.arrayContaining(['overlap_group', 'too_many_chaos']));
    const empty = {
      actions: [[], ['clean_sheet'], ['plays_90'], ['plays_90'], ['goal']],
      captain: null,
      bold: null,
    };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/picks/${g1.id}/confirm`,
          headers: u.headers,
          payload: empty,
        })
      ).json().details[0].code,
    ).toBe('too_few_actions');
  });

  it('server rejects edits at and after the deadline, whatever the client thinks', async () => {
    const u = await player('07700900503');
    const g1 = await gw(1);
    const auto = (
      await app.inject({
        method: 'POST',
        url: '/picks/suggest',
        headers: u.headers,
        payload: { kind: 'auto' },
      })
    ).json();
    t.clock.set(g1.deadlineAt);
    const r = await app.inject({
      method: 'POST',
      url: `/picks/${g1.id}/confirm`,
      headers: { ...u.headers, date: 'Mon, 01 Jan 2024 00:00:00 GMT' },
      payload: auto.selection,
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe('locked');
    t.clock.set(new Date(g1.deadlineAt.getTime() - 10 * MINUTE));
  });

  it('missed deadline carries last week’s actions over; "Same as last week" offers them', async () => {
    const u = await player('07700900504');
    const g1 = await gw(1);
    const g2 = await gw(2);
    const sel = {
      actions: [['saves_3plus'], ['clean_sheet'], ['plays_90'], ['goal_involvement'], ['goal', 'assist']],
      captain: 4,
      bold: null,
    };
    expect(
      (await app.inject({ method: 'POST', url: `/picks/${g1.id}/confirm`, headers: u.headers, payload: sel }))
        .statusCode,
    ).toBe(200);
    t.clock.set(g1.deadlineAt);
    await tick(t.ctx);
    // GW2: suggestion = last week
    const last = (
      await app.inject({
        method: 'POST',
        url: '/picks/suggest',
        headers: u.headers,
        payload: { kind: 'last_week' },
      })
    ).json();
    expect(last.selection.actions[4]).toEqual(['goal', 'assist']);
    expect(last.selection.captain).toBe(4);
    expect((await app.inject({ method: 'GET', url: '/picks', headers: u.headers })).json().hasLastWeek).toBe(
      true,
    );
    // never confirms GW2
    t.clock.set(g2.deadlineAt);
    await tick(t.ctx);
    const [row] = await t.db
      .select()
      .from(selections)
      .where(and(eq(selections.userId, u.userId), eq(selections.gameweekId, g2.id)));
    expect(row!.carriedOver).toBe(true);
    const body = row!.body as StoredSelection;
    expect(body.starters[4]!.actions).toEqual(['goal', 'assist']);
    expect(body.captain).toBe(4);
    // no weekly free pack for a carried-over week
    expect(
      await t.db
        .select()
        .from(packs)
        .where(eq(packs.grantKey, `weekly:${u.userId}:${g2.id}`)),
    ).toHaveLength(0);
  });
});
