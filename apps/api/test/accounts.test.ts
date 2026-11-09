import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { cards, packs, users } from '../src/db/schema.js';
import { hashPhone, normalisePhone } from '../src/services/phone.js';
import { getPacksConfig } from '../src/services/config.js';
import { checkSquad } from '../src/services/squad.js';
import { datasetCtx, signUp } from './fixtures.js';

let t: Awaited<ReturnType<typeof datasetCtx>>;
let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  t = await datasetCtx([1, 2]);
  app = await buildApp(t.ctx);
});
afterAll(() => t.close());

describe('phone sign-up', () => {
  it('normalises UK numbers and stores only a hash', () => {
    expect(normalisePhone('07700 900123')).toBe('+447700900123');
    expect(() => normalisePhone('123')).toThrow();
  });

  it('rejects a wrong code and locks after five attempts', async () => {
    await app.inject({ method: 'POST', url: '/auth/start', payload: { phone: '07700900001' } });
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({
        method: 'POST',
        url: '/auth/verify',
        payload: { phone: '07700900001', code: '000000' },
      });
      expect(r.statusCode).toBe(401);
    }
    const locked = await app.inject({
      method: 'POST',
      url: '/auth/verify',
      payload: { phone: '07700900001', code: t.ctx.otp.sent.get(hashPhone('+447700900001'))! },
    });
    expect(locked.json().error).toBe('otp_locked');
  });

  it('signs up, requires 16+ and the disclaimer, then grants a starter pack', async () => {
    const phone = '07700900123';
    await app.inject({ method: 'POST', url: '/auth/start', payload: { phone } });
    const code = t.ctx.otp.sent.get(hashPhone(normalisePhone(phone)))!;
    const v = await app.inject({ method: 'POST', url: '/auth/verify', payload: { phone, code } });
    expect(v.statusCode).toBe(200);
    expect(v.json().isNew).toBe(true);
    const headers = { authorization: `Bearer ${v.json().token}` };

    const [u] = await t.db.select().from(users).where(eq(users.id, v.json().user.id));
    expect(u!.phoneHash).not.toContain('7700');

    expect((await app.inject({ method: 'GET', url: '/squad', headers })).json().error).toBe(
      'profile_incomplete',
    );
    const noAge = await app.inject({
      method: 'POST',
      url: '/me/profile',
      headers,
      payload: { displayName: 'Sam', ageConfirmed: false, disclaimerAccepted: true },
    });
    expect(noAge.json().error).toBe('age_required');
    const noDisc = await app.inject({
      method: 'POST',
      url: '/me/profile',
      headers,
      payload: { displayName: 'Sam', ageConfirmed: true, disclaimerAccepted: false },
    });
    expect(noDisc.json().error).toBe('disclaimer_required');

    const ok = await app.inject({
      method: 'POST',
      url: '/me/profile',
      headers,
      payload: { displayName: 'Sam', ageConfirmed: true, disclaimerAccepted: true },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.profileComplete).toBe(true);
    // Profile again does not grant a second starter pack.
    const again = await app.inject({
      method: 'POST',
      url: '/me/profile',
      headers,
      payload: { displayName: 'Sam2', ageConfirmed: true, disclaimerAccepted: true },
    });
    expect(again.json().starterPackId).toBe(ok.json().starterPackId);
    expect((await app.inject({ method: 'GET', url: '/packs', headers })).json()).toHaveLength(1);
  });
});

describe('starter pack', () => {
  it('opens server-side into a valid, balanced, auto-placed squad with logged odds and seed', async () => {
    const { headers, starterPackId, userId } = await signUp(app, t, '07700900200');
    const pack = (await app.inject({ method: 'GET', url: '/packs', headers })).json()[0];
    expect(pack.status).toBe('sealed'); // never auto-opens
    expect(pack.odds).toEqual({ bronze: 0.8, silver: 0.2 });

    const res = await app.inject({ method: 'POST', url: `/packs/${starterPackId}/open`, headers });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cards.map((c: { position: string }) => c.position)).toEqual([
      'GK',
      'DEF',
      'MID',
      'MID',
      'FWD',
    ]);
    const rar = body.cards.map((c: { rarity: string }) => c.rarity).sort();
    expect(rar).toEqual(['bronze', 'bronze', 'bronze', 'bronze', 'silver']);

    const [row] = await t.db.select().from(packs).where(eq(packs.id, starterPackId));
    expect(row!.seed).toMatch(/^\d+$/);
    expect(row!.oddsVersion).toBe('0.1');
    expect(row!.result).toBeTruthy();

    const squad = (await app.inject({ method: 'GET', url: '/squad', headers })).json();
    expect(squad).toHaveLength(5);
    expect(
      await checkSquad(
        t.db,
        userId,
        squad.map((s: { cardId: string }) => s.cardId),
      ),
    ).toEqual([]);
    const clubs = new Map<string, number>();
    for (const s of squad) clubs.set(s.clubId, (clubs.get(s.clubId) ?? 0) + 1);
    expect(Math.max(...clubs.values())).toBeLessThanOrEqual(2);

    const again = await app.inject({ method: 'POST', url: `/packs/${starterPackId}/open`, headers });
    expect(again.statusCode).toBe(409);
  });

  it('is reproducible from the logged seed', async () => {
    const { planPack } = await import('../src/services/packs.js');
    const { players, clubs } = await import('../src/db/schema.js');
    const { rarityForRating } = await import('@ff/shared');
    const cfg = await getPacksConfig(t.db);
    const rows = await t.db
      .select({
        id: players.id,
        name: players.name,
        position: players.position,
        clubId: players.clubId,
        rating: players.rating,
        clubCode: clubs.code,
      })
      .from(players)
      .innerJoin(clubs, eq(clubs.id, players.clubId));
    const pool = rows
      .map((r) => ({ ...r, clubId: r.clubId!, rarity: rarityForRating(cfg, r.rating) }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const a = planPack(cfg, { type: 'squad', rarity: null }, pool, 12345);
    const b = planPack(cfg, { type: 'squad', rarity: null }, pool, 12345);
    expect(a.map((x) => x.player.id)).toEqual(b.map((x) => x.player.id));
  });
});

describe('squad rules', () => {
  it('rejects wrong positions, the club limit, the rating cap and cards you do not own', async () => {
    const a = await signUp(app, t, '07700900300');
    const b = await signUp(app, t, '07700900301');
    await app.inject({ method: 'POST', url: `/packs/${a.starterPackId}/open`, headers: a.headers });
    await app.inject({ method: 'POST', url: `/packs/${b.starterPackId}/open`, headers: b.headers });
    const sq = (await app.inject({ method: 'GET', url: '/squad', headers: a.headers })).json() as {
      cardId: string;
    }[];
    const ids = sq.map((s) => s.cardId);

    const swapped = [ids[1]!, ids[0]!, ...ids.slice(2)];
    expect(
      (
        await app.inject({ method: 'PUT', url: '/squad', headers: a.headers, payload: { slots: swapped } })
      ).json().details[0].code,
    ).toBe('wrong_position');

    const otherCard = (await app.inject({ method: 'GET', url: '/squad', headers: b.headers })).json()[0]
      .cardId;
    const stolen = [otherCard, ...ids.slice(1)];
    expect(
      (
        await app.inject({ method: 'PUT', url: '/squad', headers: a.headers, payload: { slots: stolen } })
      ).json().details[0].code,
    ).toBe('not_owned');

    // Rating cap: inflate ratings.
    for (const id of ids) await t.db.update(cards).set({ rating: 95 }).where(eq(cards.id, id));
    expect(
      (await app.inject({ method: 'PUT', url: '/squad', headers: a.headers, payload: { slots: ids } })).json()
        .details[0].code,
    ).toBe('rating_cap');
    for (const id of ids) await t.db.update(cards).set({ rating: 60 }).where(eq(cards.id, id));
    expect(
      (await app.inject({ method: 'PUT', url: '/squad', headers: a.headers, payload: { slots: ids } }))
        .statusCode,
    ).toBe(200);
  });
});
