import { and, eq, isNotNull } from 'drizzle-orm';
import type { SquadScore } from '@ff/scoring';
import { scoreSquad } from '@ff/scoring';
import type { AppContext } from '../context.js';
import { gameweekScores, gameweeks, selections } from '../db/schema.js';
import { getRules } from './config.js';
import type { StoredSelection } from './selection-body.js';
import { loadGameweekStats, statsForSelection } from './stats.js';

export interface ScoredUser {
  userId: string;
  score: SquadScore;
  previous: SquadScore | null;
}

/**
 * Re-score every locked selection for a gameweek from the stored raw stats. Deterministic and idempotent:
 * running it twice with the same stats writes the same rows. Uses the rules version fixed at lock.
 */
export async function scoreGameweek(
  ctx: AppContext,
  gameweekId: string,
  opts: { provisional: boolean },
): Promise<ScoredUser[]> {
  const { db } = ctx;
  const [gw] = await db.select().from(gameweeks).where(eq(gameweeks.id, gameweekId));
  if (!gw) throw new Error(`No gameweek ${gameweekId}`);
  const rules = await getRules(db, gw.scoringVersion ?? undefined, gw.season);
  const data = await loadGameweekStats(db, gameweekId);
  const sels = await db
    .select()
    .from(selections)
    .where(and(eq(selections.gameweekId, gameweekId), isNotNull(selections.lockedAt)));
  const prevRows = new Map(
    (await db.select().from(gameweekScores).where(eq(gameweekScores.gameweekId, gameweekId))).map((r) => [
      r.userId,
      r,
    ]),
  );
  const now = ctx.clock.now();
  const out: ScoredUser[] = [];
  for (const s of sels) {
    const body = s.body as StoredSelection;
    const score = scoreSquad(rules, body, statsForSelection(body, data));
    const provisional = opts.provisional || score.provisional;
    const values = {
      rulesVersion: rules.version,
      total: score.total,
      actionsLanded: score.actionsLanded,
      actionsPicked: score.actionsPicked,
      provisional,
      breakdown: score,
      computedAt: now,
    };
    await db
      .insert(gameweekScores)
      .values({ userId: s.userId, gameweekId, ...values })
      .onConflictDoUpdate({ target: [gameweekScores.userId, gameweekScores.gameweekId], set: values });
    out.push({
      userId: s.userId,
      score,
      previous: (prevRows.get(s.userId)?.breakdown as SquadScore | undefined) ?? null,
    });
  }
  return out;
}
