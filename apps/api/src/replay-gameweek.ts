/* Staging replay: drive one gameweek of the 2025/26 dataset through every job on a fake clock and print the
 * timeline of locks, live score changes and notifications.
 *   DATABASE_URL=… pnpm --filter @ff/api replay:gameweek --gw 12 [--step 10]
 * Use a staging or scratch database: it writes real rows (selections, scores, notifications). */
import { asc, eq } from 'drizzle-orm';
import { FakeClock, HOUR, MINUTE } from './clock.js';
import type { AppContext } from './context.js';
import { createDb } from './db/client.js';
import { fixtures, gameweeks } from './db/schema.js';
import { tick } from './jobs/tick.js';
import { FplDatasetProvider } from './providers/fpl-dataset.js';
import { SEASON, seedConfigs } from './services/config.js';
import { syncReferenceData } from './services/ingest.js';
import { LocalOtpService } from './services/otp.js';
import { MemoryPushSender } from './services/push.js';

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1]! : d;
};
const number = Number(arg('--gw', '1'));
const step = Number(arg('--step', '10')) * MINUTE;

const { db, close } = await createDb(process.env.DATABASE_URL ?? 'memory://');
await seedConfigs(db);
const clock = new FakeClock(new Date(0));
const push = new MemoryPushSender();
const ctx: AppContext = {
  db,
  clock,
  provider: new FplDatasetProvider({ clock }),
  otp: new LocalOtpService(db, clock),
  push,
};
// Pre-season sync creates the gameweeks; a second sync just before the deadline registers that week's squads.
clock.set(new Date('2026-07-01T00:00:00Z'));
await syncReferenceData(ctx, SEASON);
const [gw0] = await db.select().from(gameweeks).where(eq(gameweeks.number, number));
if (!gw0) throw new Error(`No GW${number}`);
clock.set(new Date(gw0.deadlineAt.getTime() - 26 * HOUR));
await syncReferenceData(ctx, SEASON);
const [gw] = await db.select().from(gameweeks).where(eq(gameweeks.number, number));
if (!gw) throw new Error(`No GW${number}`);
const fx = await db
  .select()
  .from(fixtures)
  .where(eq(fixtures.gameweekId, gw.id))
  .orderBy(asc(fixtures.kickoffAt));
const end = gw.finaliseAt.getTime() + 5 * MINUTE;
const busy = (ms: number) =>
  fx.some(
    (f) => f.kickoffAt && ms >= f.kickoffAt.getTime() - 5 * MINUTE && ms <= f.kickoffAt.getTime() + 2 * HOUR,
  );
let seen = 0;
// Never step over the key instants (deadline, finalisation).
const keys = [gw.deadlineAt.getTime(), gw.finaliseAt.getTime()];
const nextTime = (ms: number) => {
  const n = ms + (busy(ms) ? step : HOUR);
  return Math.min(n, ...keys.filter((k) => k > ms));
};
for (let ms = clock.now().getTime(); ms <= end; ms = nextTime(ms)) {
  clock.set(new Date(ms));
  const r = await tick(ctx);
  const lines: string[] = [];
  for (const l of r.locked)
    lines.push(`locked GW${l.number}: ${l.locked} squads, ${l.carriedOver.length} carried over`);
  for (const p of r.polled)
    if (p.statsChanged)
      lines.push(
        `live GW${p.number}: ${p.statsChanged} stat changes, ${p.scored.length} squads re-scored (${p.status})`,
      );
  for (const f of r.finalised) lines.push(`finalised GW${f.gameweek.number}: ${f.scored.length} squads`);
  for (const m of push.sent.slice(seen)) lines.push(`push → ${m.title} — ${m.body}`);
  seen = push.sent.length;
  if (lines.length)
    console.log(`${clock.now().toISOString()}  ${lines.join('\n                          ')}`);
}
const [final] = await db.select().from(gameweeks).where(eq(gameweeks.id, gw.id));
console.log(
  `GW${number} ended ${final?.status} at ${clock.now().toISOString()} (finalise ${final?.finaliseAt.toISOString()})`,
);
await close();
