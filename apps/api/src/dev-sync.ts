/* Dev helper: one reference sync + one tick against the real clock (replays any past gameweeks). */
import { createContext } from './bootstrap.js';
import { dailySync, tick } from './jobs/tick.js';

const ctx = await createContext();
console.log('sync', await dailySync(ctx));
const t = await tick(ctx);
console.log('tick', { locked: t.locked.length, polled: t.polled.length, finalised: t.finalised.length });
process.exit(0);
