import type { AppContext } from '../context.js';
import { syncReferenceData } from '../services/ingest.js';
import {
  queueCardChanges,
  queueCarriedOver,
  queueLandedAlerts,
  queueRecapReady,
} from '../services/live-notify.js';
import { ingestMoves, processDueMoves } from '../services/moves.js';
import { deliverNotifications, queueDeadlineReminders } from '../services/notifications.js';
import { finaliseDueGameweeks, lockDueGameweeks, pollLiveGameweeks } from './gameweek.js';
import { afterFinalise } from './hooks.js';

/**
 * One idempotent pass of every scheduled job, driven by the server clock. The worker runs it every minute;
 * tests and staging replays call it directly after moving a fake clock.
 */
export async function tick(ctx: AppContext) {
  const moves = await processDueMoves(ctx); // transfers take effect at the deadline, before locking
  await queueCardChanges(ctx, moves);
  await queueDeadlineReminders(ctx);
  const locked = await lockDueGameweeks(ctx);
  for (const l of locked) await queueCarriedOver(ctx, { id: l.gameweekId, number: l.number }, l.carriedOver);
  const polled = await pollLiveGameweeks(ctx);
  for (const p of polled) await queueLandedAlerts(ctx, { id: p.gameweekId, number: p.number }, p.scored);
  const finalised = await finaliseDueGameweeks(ctx);
  for (const f of finalised) {
    await queueLandedAlerts(ctx, f.gameweek, f.scored);
    await afterFinalise(ctx, f);
    await queueRecapReady(ctx, f.gameweek, f.scored);
  }
  const delivered = await deliverNotifications(ctx);
  return { moves, locked, polled, finalised, delivered };
}

/** Daily: refresh clubs, players, fixtures and gameweeks; pull registered transfers. */
export async function dailySync(ctx: AppContext) {
  const ref = await syncReferenceData(ctx);
  const moves = await ingestMoves(ctx, new Date(0));
  return { ...ref, moves };
}
