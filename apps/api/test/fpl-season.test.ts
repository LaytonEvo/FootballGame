import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { HOUR } from '../src/clock.js';
import { gameweeks, playerMoves, players } from '../src/db/schema.js';
import { tick } from '../src/jobs/tick.js';
import { FplSeasonProvider } from '../src/providers/fpl-season.js';
import { syncReferenceData } from '../src/services/ingest.js';
import { LocalOtpService } from '../src/services/otp.js';
import { availabilityWarning } from '../src/services/picks.js';
import { MemoryPushSender } from '../src/services/push.js';
import { testCtx } from './helpers.js';

// A two-club, one-fixture-per-gameweek miniature of the public 2026/27 files.
const teams = 'id,name,short_name\n1,Arsenal,ARS\n2,Coventry City,COV\n';
const playersCsv = (saliba = 'i', martinelliClub = '1', martinelliStatus = 'a', canSelect = 'True') =>
  'id,first_name,second_name,element_type,team,now_cost,total_points,minutes,status,can_select,news\n' +
  `1,David,Raya,1,1,60,40,540,a,True,\n` +
  `2,William,Saliba,2,1,60,30,450,${saliba},True,Back injury - Unknown return date\n` +
  `3,Gabriel,Martinelli,3,${martinelliClub},70,20,300,${martinelliStatus},${canSelect},${martinelliStatus === 'u' ? 'Has joined Al Hilal permanently' : ''}\n` +
  `4,Viktor,Gyokeres,4,1,90,60,540,a,True,\n` +
  `5,Oliver,Dovin,1,2,45,20,540,a,True,\n` +
  `6,Jake,Bidwell,2,2,45,10,540,a,True,\n` +
  `7,Victor,Torp,3,2,50,15,540,a,True,\n` +
  `8,Ellis,Simms,4,2,55,25,540,a,True,\n`;
const fixtures = (gw1Finished: boolean) =>
  'id,event,kickoff_time,team_h,team_a,team_h_score,team_a_score,finished,started\n' +
  `1,1,2026-08-21T19:00:00Z,1,2,${gw1Finished ? '3,0,True,True' : ',,False,True'}\n` +
  `2,2,2026-08-29T14:00:00Z,2,1,,,False,False\n`;
const merged = (withGw1: boolean) =>
  'element,name,team,fixture,GW,minutes,goals_scored,assists,clean_sheets,goals_conceded,saves,penalties_saved,yellow_cards,red_cards\n' +
  (withGw1
    ? [
        '1,David Raya,Arsenal,1,1,90,0,0,1,0,2,0,0,0',
        '4,Viktor Gyokeres,Arsenal,1,1,90,2,0,1,0,0,0,0,0',
        '5,Oliver Dovin,Coventry City,1,1,90,0,0,0,3,4,0,0,0',
      ].join('\n') + '\n'
    : '');

function files(state: {
  gw1Finished: boolean;
  withStats: boolean;
  martinelli?: [string, string, string];
  saliba?: string;
}) {
  return async (url: string) => {
    if (url.endsWith('/teams.csv')) return teams;
    if (url.endsWith('/players_raw.csv'))
      return playersCsv(state.saliba, ...(state.martinelli ?? ['1', 'a', 'True']));
    if (url.endsWith('/fixtures.csv')) return fixtures(state.gw1Finished);
    if (url.endsWith('/gws/merged_gw.csv')) return merged(state.withStats);
    throw new Error(url);
  };
}

describe('2026/27 public dataset provider', () => {
  it('maps clubs, squads (with injury news and departures), fixtures and final stats', async () => {
    const t = await testCtx('2026-08-22T12:00:00Z');
    const p = new FplSeasonProvider(
      t.clock,
      'https://example.test/2026-27',
      files({ gw1Finished: false, withStats: false, martinelli: ['1', 'u', 'False'] }),
    );
    expect((await p.clubs()).map((c) => c.code)).toEqual(['ARS', 'COV']);
    const squad = await p.squads();
    const saliba = squad.find((x) => x.name === 'William Saliba')!;
    expect(saliba).toMatchObject({
      position: 'DEF',
      availability: 'injured',
      news: 'Back injury - Unknown return date',
      status: 'active',
    });
    expect(squad.find((x) => x.name === 'Gabriel Martinelli')).toMatchObject({
      status: 'left_league',
      clubRef: null,
    });
    const fx = await p.fixtures();
    expect(fx[0]).toMatchObject({ status: 'live', homeScore: null }); // kicked off, dataset not updated yet
    expect(fx[1]!.status).toBe('scheduled');
    expect(await p.liveMatchStats()).toEqual([]);
    expect(await p.finalMatchStats('fpl27:f1')).toEqual([]);
    await t.close();
  });

  it('a gameweek waits for late stats, then finalises; departures and injuries flow through the sync', async () => {
    const t = await testCtx('2026-08-10T12:00:00Z');
    const state = { gw1Finished: false, withStats: false } as Parameters<typeof files>[0];
    const fetch = (url: string) => files(state)(url);
    const provider = new FplSeasonProvider(t.clock, 'https://example.test/2026-27', fetch);
    const ctx = {
      db: t.db,
      clock: t.clock,
      provider,
      otp: new LocalOtpService(t.db, t.clock),
      push: new MemoryPushSender(),
    };
    await syncReferenceData(ctx);
    const [gw1] = await t.db.select().from(gameweeks).where(eq(gameweeks.number, 1));
    expect(
      (await t.db.select().from(players).where(eq(players.name, 'William Saliba')))[0]!.availability,
    ).toBe('injured');

    // Past the 09:00 finalisation but the dataset still has no result: keep waiting.
    t.clock.set(new Date(gw1!.finaliseAt.getTime() + 2 * HOUR));
    await tick(ctx);
    expect((await t.db.select().from(gameweeks).where(eq(gameweeks.id, gw1!.id)))[0]!.status).not.toBe(
      'finalised',
    );

    // Dataset updated with the result but not yet the player stats: still waiting.
    state.gw1Finished = true;
    t.clock.advance(HOUR); // past the 15-minute cache
    await tick(ctx);
    expect((await t.db.select().from(gameweeks).where(eq(gameweeks.id, gw1!.id)))[0]!.status).not.toBe(
      'finalised',
    );

    // Stats arrive: finalised.
    state.withStats = true;
    t.clock.advance(HOUR);
    await tick(ctx);
    expect((await t.db.select().from(gameweeks).where(eq(gameweeks.id, gw1!.id)))[0]!.status).toBe(
      'finalised',
    );

    // Martinelli leaves: the sync records a move that takes effect at the next deadline.
    state.martinelli = ['1', 'u', 'False'];
    t.clock.advance(HOUR);
    await syncReferenceData(ctx);
    const moves = await t.db.select().from(playerMoves);
    expect(moves.map((m) => m.kind)).toEqual(['left_league']);
    await t.close();
  });

  it('injury news becomes the pick-screen warning', () => {
    expect(
      availabilityWarning([], true, { availability: 'injured', news: 'Back injury - Unknown return date' }),
    ).toBe('Injured: Back injury - Unknown return date');
    expect(availabilityWarning([], true, { availability: 'suspended', news: null })).toBe('Suspended');
    expect(availabilityWarning([], false, { availability: 'injured', news: 'x' })).toBe(
      'No match this gameweek',
    );
  });
});

describe('form and warnings skip gameweeks still waiting for stats', () => {
  it('a gameweek with no results yet does not count as 0 minutes', async () => {
    const t = await testCtx('2026-08-10T12:00:00Z');
    const state = { gw1Finished: true, withStats: false } as Parameters<typeof files>[0];
    const provider = new FplSeasonProvider(t.clock, 'https://example.test/2026-27', (u) => files(state)(u));
    const ctx = {
      db: t.db,
      clock: t.clock,
      provider,
      otp: new LocalOtpService(t.db, t.clock),
      push: new MemoryPushSender(),
    };
    await syncReferenceData(ctx);
    const [gw1] = await t.db.select().from(gameweeks).where(eq(gameweeks.number, 1));
    t.clock.set(new Date(gw1!.finaliseAt.getTime() + HOUR));
    await tick(ctx); // GW1 locked and waiting: no stats
    const { pickScreen } = await import('../src/services/picks.js');
    const { cards, squadSlots, users } = await import('../src/db/schema.js');
    const ps = await t.db.select().from(players);
    const uid = 'u-season';
    await t.db.insert(users).values({ id: uid, phoneHash: 'h', inviteCode: 'SEASON01' });
    const shape = ['GK', 'DEF', 'MID', 'MID', 'FWD'];
    const used = new Set<string>();
    for (const [slot, pos] of shape.entries()) {
      const p = ps.find(
        (x) => x.position === pos && x.clubId && !used.has(x.id) && x.name !== 'William Saliba',
      )!;
      used.add(p.id);
      await t.db
        .insert(cards)
        .values({ id: `c${slot}`, userId: uid, playerId: p.id, rarity: 'bronze', rating: p.rating });
      await t.db.insert(squadSlots).values({ userId: uid, slot, cardId: `c${slot}` });
    }
    const screen = await pickScreen(ctx, uid);
    expect(screen.gameweek.number).toBe(2);
    expect(screen.slots.map((s) => s.warning)).toEqual([null, null, null, null, null]);
    await t.close();
  });
});
