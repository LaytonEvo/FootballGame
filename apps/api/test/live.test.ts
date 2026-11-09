import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { SquadScore } from '@ff/scoring';
import { buildApp } from '../src/app.js';
import { HOUR, MINUTE } from '../src/clock.js';
import { fixtures, gameweekScores, gameweeks, notifications, users } from '../src/db/schema.js';
import { tick } from '../src/jobs/tick.js';
import { matchMinute } from '../src/services/live.js';
import { grantPack } from '../src/services/packs.js';
import { datasetCtx, findPlayers, giveSquad, signUp } from './fixtures.js';

let t: Awaited<ReturnType<typeof datasetCtx>>;
let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  t = await datasetCtx([1]);
  app = await buildApp(t.ctx);
});
afterAll(() => t.close());

async function player(phone: string, token: string) {
  const u = await signUp(app, t, phone);
  // Fixed squad of regulars who played 90 in GW1 (starter packs are random).
  const picks = findPlayers(1, [
    { position: 'GK', where: (m) => m.stats.minutes >= 90 },
    { position: 'DEF', where: (m) => m.stats.minutes >= 90 },
    { position: 'MID', where: (m) => m.stats.minutes >= 90 },
    { position: 'MID', where: (m) => m.stats.minutes >= 90 },
    { position: 'FWD', where: (m) => m.stats.minutes >= 90 },
  ]);
  await giveSquad(
    t.db,
    u.userId,
    picks.map((m) => m.playerId),
    'bronze',
  );
  await app.inject({ method: 'POST', url: '/me/push-token', headers: u.headers, payload: { token } });
  return u;
}

describe('match minute', () => {
  it('pauses at half-time', () => {
    const k = new Date('2026-08-15T14:00:00Z');
    expect(matchMinute(k, new Date(k.getTime() + 30 * MINUTE))).toBe(30);
    expect(matchMinute(k, new Date(k.getTime() + 55 * MINUTE))).toBe(45);
    expect(matchMinute(k, new Date(k.getTime() + 80 * MINUTE))).toBe(65);
  });
});

describe('replaying a gameweek: live updates and notifications', () => {
  it('sends the right pushes at the right times and shows live state', async () => {
    const keen = await player('07700900600', 'ExponentPushToken[keen]');
    const lazy = await player('07700900601', 'ExponentPushToken[lazy]');
    // keen turns off "action landed"
    await app.inject({
      method: 'PUT',
      url: '/me/notifications',
      headers: keen.headers,
      payload: { action_landed: false },
    });
    const [gw] = await t.db.select().from(gameweeks);
    const auto = (
      await app.inject({
        method: 'POST',
        url: '/picks/suggest',
        headers: keen.headers,
        payload: { kind: 'auto' },
      })
    ).json();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/picks/${gw!.id}/confirm`,
          headers: keen.headers,
          payload: auto.selection,
        })
      ).statusCode,
    ).toBe(200);

    const sentTo = (tok: string, kind?: string) =>
      t.ctx.push.sent.filter(
        (m) =>
          m.token === tok &&
          (!kind || (m.data as { route?: string }).route !== undefined || true) &&
          (!kind || m.title.includes(kind)),
      );
    const at = async (ms: number) => {
      t.clock.set(new Date(ms));
      return tick(t.ctx);
    };

    const d = gw!.deadlineAt.getTime();
    await at(d - 30 * HOUR);
    expect(t.ctx.push.sent).toHaveLength(0);
    await at(d - 23 * HOUR);
    await at(d - 22 * HOUR); // no duplicate
    expect(sentTo('ExponentPushToken[lazy]', 'locks tomorrow')).toHaveLength(1);
    expect(sentTo('ExponentPushToken[keen]')).toHaveLength(0); // confirmed: no reminder
    await at(d - 2 * HOUR + MINUTE);
    expect(sentTo('ExponentPushToken[lazy]', 'locks in 2 hours')).toHaveLength(1);

    await at(d);
    expect(sentTo('ExponentPushToken[lazy]', 'carried over')).toHaveLength(1);
    expect(sentTo('ExponentPushToken[keen]', 'carried over')).toHaveLength(0);

    // Step through every match window.
    const fx = await t.db.select().from(fixtures);
    const times = [
      ...new Set(fx.flatMap((f) => [20, 50, 80, 105, 125].map((m) => f.kickoffAt!.getTime() + m * MINUTE))),
    ].sort((a, b) => a - b);
    let sawLive = false;
    for (const ms of times) {
      await at(ms);
      if (!sawLive) {
        const home = (await app.inject({ method: 'GET', url: '/home', headers: lazy.headers })).json();
        if (home.mode === 'live' && home.live) {
          sawLive = true;
          expect(home.live.slots).toHaveLength(5);
          expect(home.live.provisional).toBe(true);
          expect(
            home.live.slots.flatMap((s: { lines: { state: string }[] }) => s.lines.map((l) => l.state)),
          ).toContain('pending');
        }
      }
    }
    expect(sawLive).toBe(true);

    // Landed pushes for the lazy user are merged per minute and match the final breakdown.
    const [lazyScore] = await t.db
      .select()
      .from(gameweekScores)
      .where(eq(gameweekScores.userId, lazy.userId));
    const landedLines = (lazyScore!.breakdown as SquadScore).slots
      .filter((s) => s.counts)
      .flatMap((s) => s.lines.filter((l) => l.state === 'landed'));
    const landedRows = await t.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, lazy.userId), eq(notifications.kind, 'action_landed')));
    expect(landedRows).toHaveLength(landedLines.length);
    expect(landedRows.every((r) => r.sentAt && !r.suppressed)).toBe(true);
    const landedPushes = t.ctx.push.sent.filter(
      (m) => m.token === 'ExponentPushToken[lazy]' && m.title.includes('landed'),
    );
    expect(landedLines.length).toBeGreaterThan(0);
    expect(landedPushes.length).toBeGreaterThan(0);
    expect(landedPushes.length).toBeLessThanOrEqual(landedRows.length);

    // keen switched landed alerts off: rows kept for audit, nothing pushed.
    const keenLanded = await t.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, keen.userId), eq(notifications.kind, 'action_landed')));
    expect(keenLanded.every((r) => r.suppressed === 'pref_off')).toBe(true);
    expect(
      t.ctx.push.sent.filter((m) => m.token === 'ExponentPushToken[keen]' && m.title.includes('landed')),
    ).toHaveLength(0);

    // 09:00 finalisation → recap ready for both.
    await at(gw!.finaliseAt.getTime());
    expect(sentTo('ExponentPushToken[lazy]', 'recap is ready')).toHaveLength(1);
    expect(sentTo('ExponentPushToken[keen]', 'recap is ready')).toHaveLength(1);
    await at(gw!.finaliseAt.getTime() + 5 * MINUTE);
    expect(sentTo('ExponentPushToken[lazy]', 'recap is ready')).toHaveLength(1);

    // New-pack pushes: max one a day.
    const now = t.clock.now();
    await grantPack(t.db, now, lazy.userId, 'swap', 'compensation', 'test:comp1', 'bronze');
    await grantPack(t.db, now, lazy.userId, 'swap', 'compensation', 'test:comp2', 'bronze');
    await at(now.getTime() + MINUTE);
    expect(sentTo('ExponentPushToken[lazy]', 'New pack')).toHaveLength(1);
    const capped = await t.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, lazy.userId), eq(notifications.suppressed, 'daily_cap')));
    expect(capped).toHaveLength(1);

    const [u] = await t.db.select().from(users).where(eq(users.id, keen.userId));
    expect((u!.notificationPrefs as Record<string, boolean>).action_landed).toBe(false);
  });
});
