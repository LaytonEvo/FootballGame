import { afterEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { SquadScore } from '@ff/scoring';
import { HOUR, MINUTE } from '../src/clock.js';
import { fixtures, gameweekScores, gameweeks, selections, statRevisions } from '../src/db/schema.js';
import { recordLateRevisions } from '../src/jobs/gameweek.js';
import { tick } from '../src/jobs/tick.js';
import { syncReferenceData } from '../src/services/ingest.js';
import type { StoredSelection } from '../src/services/selection-body.js';
import { currentSquadSelection } from '../src/services/squad-read.js';
import { finalisationTime } from '../src/time.js';
import { datasetCtx, ds, findPlayers, userWithSquad } from './fixtures.js';

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

describe('London time', () => {
  it('finalises at 09:00 London the morning after (BST and GMT)', () => {
    expect(finalisationTime(new Date('2026-08-16T19:00:00Z')).toISOString()).toBe('2026-08-17T08:00:00.000Z');
    expect(finalisationTime(new Date('2026-12-26T20:00:00Z')).toISOString()).toBe('2026-12-27T09:00:00.000Z');
    // 23:30 UTC on 31 Aug is 00:30 BST 1 Sep → morning after is 2 Sep
    expect(finalisationTime(new Date('2026-08-31T23:30:00Z')).toISOString()).toBe('2026-09-02T08:00:00.000Z');
  });
});

describe('gameweek ingestion and lifecycle', () => {
  it('creates gameweeks with deadline 90 minutes before first kick-off', async () => {
    const t = await datasetCtx([1, 2]);
    close = t.close;
    const gws = await t.db.select().from(gameweeks);
    expect(gws.map((g) => g.number).sort()).toEqual([1, 2]);
    const gw1 = gws.find((g) => g.number === 1)!;
    expect(gw1.firstKickoffAt.getTime() - gw1.deadlineAt.getTime()).toBe(90 * MINUTE);
    expect(gw1.firstKickoffAt.toISOString()).toBe('2026-08-14T19:00:00.000Z'); // 2025-08-15 + 364 days
    expect((await t.db.select().from(fixtures)).length).toBe(20);
    // re-running is a no-op
    await syncReferenceData(t.ctx);
    expect((await t.db.select().from(gameweeks)).length).toBe(2);
  });

  it('ingests, locks, scores live, revises and finalises a gameweek end to end', async () => {
    const t = await datasetCtx([1]);
    close = t.close;
    const [gk, def, m1, m2, fwd, sub] = findPlayers(1, [
      { position: 'GK' },
      { position: 'DEF' },
      { position: 'MID' },
      { position: 'MID' },
      { position: 'FWD', where: (m) => m.stats.goals >= 1 },
      { position: 'MID' },
    ]);
    const confirmed = await userWithSquad(
      t.db,
      [gk!, def!, m1!, m2!, fwd!, sub!].map((m) => m.playerId),
    );
    const lazy = await userWithSquad(
      t.db,
      [gk!, def!, m1!, m2!, fwd!, sub!].map((m) => m.playerId),
      'bronze',
    );
    const [gw] = await t.db.select().from(gameweeks);

    // Confirmed user: goal on the striker, captain.
    const squad = (await currentSquadSelection(t.db, confirmed))!;
    squad.starters.forEach(
      (p) => (p.actions = [{ GK: 'plays_90', DEF: 'plays_90', MID: 'plays_90', FWD: 'goal' }[p.position]]),
    );
    squad.sub!.actions = ['plays_90'];
    squad.captain = 4;
    await t.db
      .insert(selections)
      .values({
        userId: confirmed,
        gameweekId: gw!.id,
        body: squad,
        confirmedAt: t.clock.now(),
        updatedAt: t.clock.now(),
      });

    // Before the deadline nothing locks.
    t.clock.set(new Date(gw!.deadlineAt.getTime() - MINUTE));
    expect((await tick(t.ctx)).locked).toEqual([]);

    // Deadline: lock. The lazy user gets carried-over (auto-picked) actions.
    t.clock.set(gw!.deadlineAt);
    const r = await tick(t.ctx);
    expect(r.locked[0]!.carriedOver).toEqual([lazy]);
    const [lazySel] = await t.db
      .select()
      .from(selections)
      .where(and(eq(selections.userId, lazy), eq(selections.gameweekId, gw!.id)));
    expect(lazySel!.carriedOver).toBe(true);
    expect((lazySel!.body as StoredSelection).starters.every((p) => p.actions.length === 2)).toBe(true);
    expect((await t.db.select().from(gameweeks))[0]!.scoringVersion).toBe('0.2');

    // Kick-off of the striker's match + 100 min: live → finished for that fixture.
    t.clock.set(new Date(new Date(fwd!.kickoff).getTime() + 364 * 24 * HOUR + 30 * MINUTE));
    const live = await tick(t.ctx);
    expect(live.polled[0]!.status).toBe('live');
    const liveScore = live.polled[0]!.scored.find((s) => s.userId === confirmed)!.score;
    expect(liveScore.provisional).toBe(true);

    // All matches over → provisional with the real totals.
    t.clock.set(new Date(gw!.lastKickoffAt.getTime() + 3 * HOUR));
    const prov = await tick(t.ctx);
    expect(prov.polled[0]!.status).toBe('provisional');
    const before = (await t.db.select().from(gameweekScores).where(eq(gameweekScores.userId, confirmed)))[0]!;
    expect(before.provisional).toBe(true);
    const fwdLine = (before.breakdown as SquadScore).slots[4]!.lines[0]!;
    expect(fwdLine.state).toBe('landed');
    expect(fwdLine.points).toBe(5 * fwd!.stats.goals * 2);

    // Stat revision before finalisation is applied.
    t.provider.reviseStat(`fpl:f${fwd!.fixtureId}`, `fpl:p${fwd!.playerId}`, { goals: fwd!.stats.goals + 1 });
    await tick(t.ctx);
    const revised = (
      await t.db.select().from(gameweekScores).where(eq(gameweekScores.userId, confirmed))
    )[0]!;
    expect(revised.total - before.total).toBe(10);

    // 09:00 next morning → finalised, not provisional.
    t.clock.set(gw!.finaliseAt);
    const fin = await tick(t.ctx);
    expect(fin.finalised).toHaveLength(1);
    const final = (await t.db.select().from(gameweekScores).where(eq(gameweekScores.userId, confirmed)))[0]!;
    expect(final.provisional).toBe(false);
    expect(final.total).toBe(revised.total);

    // A revision after finalisation is logged but never applied.
    t.provider.reviseStat(`fpl:f${fwd!.fixtureId}`, `fpl:p${fwd!.playerId}`, { goals: 0 });
    expect(await recordLateRevisions(t.ctx, gw!.id)).toBe(1);
    expect(await tick(t.ctx)).toMatchObject({ finalised: [], polled: [] });
    const after = (await t.db.select().from(gameweekScores).where(eq(gameweekScores.userId, confirmed)))[0]!;
    expect(after.total).toBe(final.total);
    const rejected = await t.db.select().from(statRevisions).where(eq(statRevisions.applied, false));
    expect(rejected).toHaveLength(1);
  });

  it('postponed match after lock voids the player and brings the sub in', async () => {
    const t = await datasetCtx([1]);
    close = t.close;
    const picks = findPlayers(1, [
      { position: 'GK' },
      { position: 'DEF' },
      { position: 'MID' },
      { position: 'MID' },
      { position: 'FWD' },
      { position: 'MID', where: (m) => m.stats.minutes >= 90 },
    ]);
    const userId = await userWithSquad(
      t.db,
      picks.map((m) => m.playerId),
    );
    const [gw] = await t.db.select().from(gameweeks);
    t.clock.set(gw!.deadlineAt);
    await tick(t.ctx);
    t.provider.setFixtureStatus(`fpl:f${picks[4]!.fixtureId}`, 'postponed');
    t.clock.set(gw!.finaliseAt);
    await tick(t.ctx);
    const [row] = await t.db.select().from(gameweekScores).where(eq(gameweekScores.userId, userId));
    const b = row!.breakdown as SquadScore;
    expect(b.slots[4]!.role).toBe('out');
    expect(b.slots[4]!.lines.every((l) => l.state === 'void' && l.voidReason === 'match_void')).toBe(true);
    expect(b.slots[5]!.role).toBe('sub_in');
    expect(row!.provisional).toBe(false);
  });

  it('handles double and blank gameweeks from the real fixture list', async () => {
    // GW26 has 11 fixtures (a club plays twice); GW31 has 8 (four clubs blank).
    const perGw = (n: number) => ds.fixtures.filter((f) => f.gameweek === n).length;
    expect(perGw(26)).toBe(11);
    expect(perGw(31)).toBe(8);
    const t = await datasetCtx([26]);
    close = t.close;
    const fx = ds.fixtures.filter((f) => f.gameweek === 26);
    const counts = new Map<number, number>();
    for (const f of fx) for (const c of [f.homeTeamId, f.awayTeamId]) counts.set(c, (counts.get(c) ?? 0) + 1);
    const doubleTeam = [...counts.entries()].find(([, n]) => n === 2)![0];
    const dgwPlayer = ds.playerMatches.filter(
      (m) => m.gameweek === 26 && m.teamId === doubleTeam && m.position === 'FWD',
    );
    const element = dgwPlayer.find(
      (m) => dgwPlayer.filter((x) => x.playerId === m.playerId).length === 2,
    )!.playerId;
    const rows = dgwPlayer.filter((m) => m.playerId === element);
    const others = findPlayers(26, [
      { position: 'GK' },
      { position: 'DEF' },
      { position: 'MID' },
      { position: 'MID' },
    ]).filter((m) => m.teamId !== doubleTeam);
    const userId = await userWithSquad(t.db, [...others.map((m) => m.playerId), element]);
    const [gw] = await t.db.select().from(gameweeks);
    t.clock.set(gw!.deadlineAt);
    await tick(t.ctx);
    // force the striker's actions to the per-goal action
    const [sel] = await t.db.select().from(selections).where(eq(selections.userId, userId));
    const body = sel!.body as StoredSelection;
    body.starters[4]!.actions = ['goal'];
    await t.db.update(selections).set({ body }).where(eq(selections.userId, userId));
    t.clock.set(gw!.finaliseAt);
    await tick(t.ctx);
    const [row] = await t.db.select().from(gameweekScores).where(eq(gameweekScores.userId, userId));
    const goals = rows.reduce((s, r) => s + r.stats.goals, 0);
    expect((row!.breakdown as SquadScore).slots[4]!.lines[0]!.points).toBe(goals * 5);
  });
});
