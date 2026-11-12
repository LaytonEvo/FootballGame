import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { CommercialProvider } from '../src/providers/commercial.js';
import { LocalOtpService } from '../src/services/otp.js';
import { MemoryPushSender } from '../src/services/push.js';
import { configVersions } from '../src/db/schema.js';
import {
  activateConfigVersion,
  getRules,
  readConfigFile,
  seedConfigs,
  upsertConfigVersion,
} from '../src/services/config.js';
import { testCtx } from './helpers.js';

let t: Awaited<ReturnType<typeof testCtx>>;
beforeAll(async () => {
  t = await testCtx();
});
afterAll(() => t.close());

describe('config seeding', () => {
  it('loads scoring and economy configs and activates them', async () => {
    const rows = await t.db.select().from(configVersions);
    expect(rows.map((r) => `${r.kind}:${r.version}:${r.active}`).sort()).toEqual([
      'economy:0.1:true',
      'packs:0.1:true',
      'scoring:0.2:true',
      'scoring:0.3:false',
    ]);
  });

  it('is idempotent', async () => {
    await seedConfigs(t.db);
    expect(await t.db.select().from(configVersions)).toHaveLength(4);
  });

  it('switches versions without a release', async () => {
    const raw = readConfigFile('scoring.v0.2.json') as {
      version: string;
      actions: { id: string; positions: Record<string, { points: number }> }[];
    };
    raw.version = '0.3-test';
    raw.actions.find((a) => a.id === 'goal')!.positions.FWD!.points = 6;
    await upsertConfigVersion(t.db, 'scoring', raw);
    expect((await getRules(t.db)).version).toBe('0.2');
    await activateConfigVersion(t.db, 'scoring', '0.3-test');
    const r = await getRules(t.db);
    expect(r.version).toBe('0.3-test');
    expect(r.byPosition.FWD.get('goal')!.points).toBe(6);
    expect((await getRules(t.db, '0.2')).byPosition.FWD.get('goal')!.points).toBe(5);
    await activateConfigVersion(t.db, 'scoring', '0.2');
    const active = await t.db.select().from(configVersions).where(eq(configVersions.active, true));
    expect(active).toHaveLength(3);
  });

  it('serves the active config over HTTP', async () => {
    const app = await buildApp({
      db: t.db,
      clock: t.clock,
      provider: new CommercialProvider(),
      otp: new LocalOtpService(t.db, t.clock),
      push: new MemoryPushSender(),
    });
    const res = await app.inject({ method: 'GET', url: '/config/active' });
    expect(res.statusCode).toBe(200);
    expect(res.json().economy.prices_coins.player_pack).toBe(100);
    const meta = await app.inject({ method: 'GET', url: '/meta' });
    expect(meta.json().disclaimer).toMatch(/Not affiliated/);
  });
});

describe('production sign-in', () => {
  it('requires a phone number and refuses guest sign-in without the bypass', async () => {
    const app = await buildApp({
      db: t.db,
      clock: t.clock,
      provider: new CommercialProvider(),
      otp: new LocalOtpService(t.db, t.clock),
      push: new MemoryPushSender(),
    });
    expect((await app.inject({ method: 'GET', url: '/meta' })).json().phoneSignIn).toBe(true);
    expect((await app.inject({ method: 'POST', url: '/auth/guest' })).statusCode).toBe(404);
  });
});
