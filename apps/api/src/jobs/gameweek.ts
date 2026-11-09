import { and, desc, eq, inArray, lt, lte } from 'drizzle-orm';
import { carryOver } from '@ff/scoring';
import type { AppContext } from '../context.js';
import type { DbOrTx } from '../db/client.js';
import { fixtures, gameweeks, selections, squadSlots } from '../db/schema.js';
import { getRules } from '../services/config.js';
import { refreshFixtures } from '../services/ingest.js';
import type { ScoredUser } from '../services/scoring.js';
import { scoreGameweek } from '../services/scoring.js';
import type { StoredSelection } from '../services/selection-body.js';
import { currentSquadSelection } from '../services/squad-read.js';
import { ingestFixtureStats } from '../services/stats.js';

type Gameweek = typeof gameweeks.$inferSelect;

export async function previousLockedSelection(
  db: DbOrTx,
  userId: string,
  gw: Gameweek,
): Promise<StoredSelection | null> {
  const [row] = await db
    .select({ body: selections.body })
    .from(selections)
    .innerJoin(gameweeks, eq(gameweeks.id, selections.gameweekId))
    .where(
      and(eq(selections.userId, userId), eq(gameweeks.season, gw.season), lt(gameweeks.number, gw.number)),
    )
    .orderBy(desc(gameweeks.number))
    .limit(1);
  return (row?.body as StoredSelection | undefined) ?? null;
}

export interface LockResult {
  gameweekId: string;
  locked: number;
  carriedOver: string[];
}

/**
 * Lock every gameweek whose deadline has passed (server clock). For each user with a full squad, the scored
 * selection is their saved one applied to their squad at the deadline; if they never confirmed, last week's
 * actions are carried over (Auto-pick fills any gap). Idempotent: only upcoming gameweeks are processed and
 * the status flips in the same transaction.
 */
export async function lockDueGameweeks(ctx: AppContext): Promise<LockResult[]> {
  const now = ctx.clock.now();
  const due = await ctx.db
    .select()
    .from(gameweeks)
    .where(and(eq(gameweeks.status, 'upcoming'), lte(gameweeks.deadlineAt, now)));
  const results: LockResult[] = [];
  for (const gw of due.sort((a, b) => a.number - b.number)) {
    const res = await ctx.db.transaction(async (tx) => {
      const [fresh] = await tx.select().from(gameweeks).where(eq(gameweeks.id, gw.id));
      if (fresh?.status !== 'upcoming') return null;
      const rules = await getRules(tx, undefined, gw.season);
      const userIds = [
        ...new Set((await tx.select({ u: squadSlots.userId }).from(squadSlots)).map((r) => r.u)),
      ];
      const carried: string[] = [];
      for (const userId of userIds) {
        const squad = await currentSquadSelection(tx, userId);
        if (!squad) continue;
        const [saved] = await tx
          .select()
          .from(selections)
          .where(and(eq(selections.userId, userId), eq(selections.gameweekId, gw.id)));
        // Selections are only stored when the user confirms, so "saved" means confirmed.
        const confirmed = !!saved?.confirmedAt;
        const source = confirmed
          ? (saved.body as StoredSelection)
          : await previousLockedSelection(tx, userId, gw);
        const body = carryOver(rules, source, squad) as StoredSelection;
        const values = { body, carriedOver: !confirmed, lockedAt: now, updatedAt: now };
        if (saved)
          await tx
            .update(selections)
            .set(values)
            .where(and(eq(selections.userId, userId), eq(selections.gameweekId, gw.id)));
        else await tx.insert(selections).values({ userId, gameweekId: gw.id, ...values });
        if (!confirmed) carried.push(userId);
      }
      await tx
        .update(gameweeks)
        .set({ status: 'locked', lockedAt: now, scoringVersion: rules.version })
        .where(eq(gameweeks.id, gw.id));
      return { gameweekId: gw.id, locked: userIds.length, carriedOver: carried };
    });
    if (res) results.push(res);
  }
  return results;
}

export interface PollResult {
  gameweekId: string;
  statsChanged: number;
  status: Gameweek['status'];
  scored: ScoredUser[];
}

const DONE = new Set(['finished', 'postponed', 'abandoned']);

/** Pull live/final stats for every started fixture in locked, live or provisional gameweeks and re-score. */
export async function pollLiveGameweeks(ctx: AppContext): Promise<PollResult[]> {
  const now = ctx.clock.now();
  const active = await ctx.db
    .select()
    .from(gameweeks)
    .where(
      and(inArray(gameweeks.status, ['locked', 'live', 'provisional']), lte(gameweeks.firstKickoffAt, now)),
    );
  const out: PollResult[] = [];
  for (const gw of active) {
    const fxIds = (
      await ctx.db.select({ id: fixtures.id }).from(fixtures).where(eq(fixtures.gameweekId, gw.id))
    ).map((f) => f.id);
    const fx = await refreshFixtures(ctx, fxIds);
    let changed = 0;
    for (const f of fx) {
      if (f.status !== 'live' && f.status !== 'finished') continue;
      const incoming =
        f.status === 'finished'
          ? await ctx.provider.finalMatchStats(f.providerRef)
          : await ctx.provider.liveMatchStats(f.providerRef);
      changed += (await ingestFixtureStats(ctx, f, incoming, false)).changed;
    }
    const allDone = fx.every((f) => f.voided || DONE.has(f.status));
    const status: Gameweek['status'] = allDone ? 'provisional' : 'live';
    if (status !== gw.status) await ctx.db.update(gameweeks).set({ status }).where(eq(gameweeks.id, gw.id));
    const scored =
      changed > 0 || status !== gw.status ? await scoreGameweek(ctx, gw.id, { provisional: true }) : [];
    out.push({ gameweekId: gw.id, statsChanged: changed, status, scored });
  }
  return out;
}

export interface FinaliseResult {
  gameweek: Gameweek;
  scored: ScoredUser[];
}

/**
 * Finalise gameweeks at 09:00 Europe/London the morning after the last match: apply last revisions, score
 * for good, and mark finalised. After this, stats never change for the gameweek. Idempotent.
 */
export async function finaliseDueGameweeks(ctx: AppContext): Promise<FinaliseResult[]> {
  const now = ctx.clock.now();
  const due = await ctx.db
    .select()
    .from(gameweeks)
    .where(and(inArray(gameweeks.status, ['locked', 'live', 'provisional']), lte(gameweeks.finaliseAt, now)));
  const out: FinaliseResult[] = [];
  for (const gw of due.sort((a, b) => a.number - b.number)) {
    const fxIds = (
      await ctx.db.select({ id: fixtures.id }).from(fixtures).where(eq(fixtures.gameweekId, gw.id))
    ).map((f) => f.id);
    const fx = await refreshFixtures(ctx, fxIds);
    if (!fx.every((f) => f.voided || DONE.has(f.status))) continue; // a match is still being played: wait
    for (const f of fx) {
      if (f.status === 'finished' && !f.voided)
        await ingestFixtureStats(ctx, f, await ctx.provider.finalMatchStats(f.providerRef), false);
    }
    const scored = await scoreGameweek(ctx, gw.id, { provisional: false });
    const [updated] = await ctx.db
      .update(gameweeks)
      .set({ status: 'finalised', finalisedAt: now })
      .where(and(eq(gameweeks.id, gw.id), inArray(gameweeks.status, ['locked', 'live', 'provisional'])))
      .returning();
    if (updated) out.push({ gameweek: updated, scored });
  }
  return out;
}

/** For finalised gameweeks: record late provider revisions without applying them (audit only). */
export async function recordLateRevisions(ctx: AppContext, gameweekId: string) {
  const fx = await ctx.db.select().from(fixtures).where(eq(fixtures.gameweekId, gameweekId));
  let rejected = 0;
  for (const f of fx) {
    if (f.status !== 'finished' || f.voided) continue;
    rejected += (await ingestFixtureStats(ctx, f, await ctx.provider.finalMatchStats(f.providerRef), true))
      .rejectedAfterFinalisation;
  }
  return rejected;
}
