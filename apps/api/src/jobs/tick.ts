import type { AppContext } from '../context.js';
import { finaliseDueGameweeks, lockDueGameweeks, pollLiveGameweeks } from './gameweek.js';

/**
 * One idempotent pass of every scheduled job, driven by the server clock. The worker runs it every minute;
 * tests and staging replays call it directly after moving a fake clock.
 */
export async function tick(ctx: AppContext) {
  const locked = await lockDueGameweeks(ctx);
  const polled = await pollLiveGameweeks(ctx);
  const finalised = await finaliseDueGameweeks(ctx);
  return { locked, polled, finalised };
}
