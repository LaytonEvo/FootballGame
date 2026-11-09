import type { AppContext } from '../context.js';
import { syncReferenceData } from '../services/ingest.js';
import { ingestMoves, processDueMoves } from '../services/moves.js';
import { finaliseDueGameweeks, lockDueGameweeks, pollLiveGameweeks } from './gameweek.js';

/**
 * One idempotent pass of every scheduled job, driven by the server clock. The worker runs it every minute;
 * tests and staging replays call it directly after moving a fake clock.
 */
export async function tick(ctx: AppContext) {
  const moves = await processDueMoves(ctx); // transfers take effect at the deadline, before locking
  const locked = await lockDueGameweeks(ctx);
  const polled = await pollLiveGameweeks(ctx);
  const finalised = await finaliseDueGameweeks(ctx);
  return { moves, locked, polled, finalised };
}

/** Daily: refresh clubs, players, fixtures and gameweeks; pull registered transfers. */
export async function dailySync(ctx: AppContext) {
  const ref = await syncReferenceData(ctx);
  const moves = await ingestMoves(ctx, new Date(0));
  return { ...ref, moves };
}
