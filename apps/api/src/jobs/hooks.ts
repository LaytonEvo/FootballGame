import type { AppContext } from '../context.js';
import type { FinaliseResult } from './gameweek.js';

type Hook = (ctx: AppContext, f: FinaliseResult) => Promise<void>;
const hooks: Hook[] = [];

/** Post-finalisation steps (Coins, milestones, recap images) register here. Each must be idempotent. */
export const onFinalise = (h: Hook) => hooks.push(h);

export async function afterFinalise(ctx: AppContext, f: FinaliseResult) {
  for (const h of hooks) await h(ctx, f);
}
