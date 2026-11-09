import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { gameweekScores, gameweeks } from '../src/db/schema.js';
import { tick } from '../src/jobs/tick.js';
import { datasetCtx, findPlayers, giveSquad, signUp } from './fixtures.js';

let t: Awaited<ReturnType<typeof datasetCtx>>;
let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  t = await datasetCtx([1]);
  app = await buildApp(t.ctx);
});
afterAll(() => t.close());

const pngSize = (b: Buffer) => ({
  png: b.subarray(1, 4).toString() === 'PNG',
  width: b.readUInt32BE(16),
  height: b.readUInt32BE(20),
});

describe('recap and share card', () => {
  it('a finalised gameweek produces a recap and both share images for every user', async () => {
    const regs = findPlayers(1, [
      { position: 'GK', where: (m) => m.stats.minutes >= 90 },
      { position: 'DEF', where: (m) => m.stats.minutes >= 90 },
      { position: 'MID', where: (m) => m.stats.minutes >= 90 },
      { position: 'MID', where: (m) => m.stats.minutes >= 90 },
      { position: 'FWD', where: (m) => m.stats.goals >= 1 },
    ]).map((m) => m.playerId);
    const a = await signUp(app, t, '07700900900', 'Layton');
    const b = await signUp(app, t, '07700900901', 'Sam');
    for (const u of [a, b]) await giveSquad(t.db, u.userId, regs, 'silver');
    const [gw] = await t.db.select().from(gameweeks);
    await app.inject({
      method: 'POST',
      url: `/picks/${gw!.id}/confirm`,
      headers: a.headers,
      payload: {
        actions: [['saves_3plus'], ['plays_90'], ['plays_90'], ['plays_90'], ['goal']],
        captain: 4,
        bold: { slot: 4, actionId: 'goal' },
      },
    });
    t.clock.set(gw!.deadlineAt);
    await tick(t.ctx);
    t.clock.set(gw!.finaliseAt);
    await tick(t.ctx);

    for (const u of [a, b]) {
      const r = await app.inject({ method: 'GET', url: `/recap/${gw!.id}`, headers: u.headers });
      expect(r.statusCode).toBe(200);
      const recap = r.json();
      const [score] = await t.db.select().from(gameweekScores).where(eq(gameweekScores.userId, u.userId));
      expect(recap.points).toBe(score!.total);
      expect(recap.provisional).toBe(false);
      expect(recap.five).toHaveLength(5);
      expect(recap.coinsEarned).toBe(Math.max(0, score!.total));
      expect(recap.invite.url).toContain(recap.inviteCode);
      for (const format of ['story', 'square'] as const) {
        const img = await app.inject({
          method: 'GET',
          url: `/recap/${gw!.id}/share.png?format=${format}`,
          headers: u.headers,
        });
        expect(img.statusCode).toBe(200);
        expect(img.headers['content-type']).toBe('image/png');
        const size = pngSize(img.rawPayload);
        expect(size).toEqual({ png: true, width: 1080, height: format === 'story' ? 1920 : 1080 });
        if (process.env.SHARE_CARD_OUT)
          writeFileSync(`${process.env.SHARE_CARD_OUT}/${u === a ? 'a' : 'b'}-${format}.png`, img.rawPayload);
      }
    }
    const best = (await app.inject({ method: 'GET', url: `/recap/${gw!.id}`, headers: a.headers })).json()
      .best;
    expect(best.label).toBe('goal');
    expect(best.bold).toBe(true);

    // The personal invite code on the card opens the sharer's own league.
    const code = (await app.inject({ method: 'GET', url: `/recap/${gw!.id}`, headers: a.headers })).json()
      .inviteCode;
    const joined = await app.inject({
      method: 'POST',
      url: '/leagues/join',
      headers: b.headers,
      payload: { code },
    });
    expect(joined.json().name).toBe("Layton's league");
    const list = (await app.inject({ method: 'GET', url: '/leagues', headers: a.headers })).json();
    expect(list[0].size).toBe(2);

    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/recap/${gw!.id}/shared`,
          headers: a.headers,
          payload: { format: 'story', channel: 'whatsapp' },
        })
      ).statusCode,
    ).toBe(200);
    const home = (await app.inject({ method: 'GET', url: '/home', headers: a.headers })).json();
    expect(home.lastRecap.number).toBe(1);
  });
});
