import { and, desc, eq } from 'drizzle-orm';
import { gameweekScores, gameweeks } from '../db/schema.js';
import { registerHomeExtra } from './home.js';

/** Home: the latest finalised gameweek's one-line recap. */
registerHomeExtra(async (ctx, userId) => {
  const [last] = await ctx.db
    .select({ s: gameweekScores, number: gameweeks.number })
    .from(gameweekScores)
    .innerJoin(gameweeks, eq(gameweeks.id, gameweekScores.gameweekId))
    .where(and(eq(gameweekScores.userId, userId), eq(gameweeks.status, 'finalised')))
    .orderBy(desc(gameweeks.number))
    .limit(1);
  return {
    lastRecap: last
      ? {
          gameweekId: last.s.gameweekId,
          number: last.number,
          points: last.s.total,
          landed: last.s.actionsLanded,
          picked: last.s.actionsPicked,
        }
      : null,
  };
});
