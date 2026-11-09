/* Scheduled jobs. With REDIS_URL: BullMQ repeatable jobs (tick every minute, reference sync daily) so only one
 * worker runs each job. Without it (local dev): a simple interval loop. Every job is idempotent. */
import { systemClock } from './clock.js';
import type { AppContext } from './context.js';
import { createDb } from './db/client.js';
import { tick } from './jobs/tick.js';
import { providerFromEnv } from './providers/index.js';
import { seedConfigs } from './services/config.js';
import { syncReferenceData } from './services/ingest.js';

const { db } = await createDb(
  process.env.DATABASE_URL ?? new URL('../.data/pglite', import.meta.url).pathname,
);
await seedConfigs(db);
const ctx: AppContext = { db, clock: systemClock, provider: providerFromEnv(systemClock) };

async function run(name: string) {
  const t0 = Date.now();
  const out = name === 'sync' ? await syncReferenceData(ctx) : await tick(ctx);
  console.log(JSON.stringify({ job: name, ms: Date.now() - t0, summary: summarise(out) }));
}
const summarise = (o: unknown) =>
  JSON.stringify(o, (_k, v) => (Array.isArray(v) ? v.length : v)).slice(0, 500);

if (process.env.REDIS_URL) {
  const { Queue, Worker } = await import('bullmq');
  const { default: IORedis } = await import('ioredis');
  const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue('ff-jobs', { connection });
  await queue.upsertJobScheduler('tick', { every: 60_000 }, { name: 'tick' });
  await queue.upsertJobScheduler('sync', { pattern: '0 4 * * *', tz: 'Europe/London' }, { name: 'sync' });
  new Worker('ff-jobs', async (job) => run(job.name), { connection, concurrency: 1 });
  console.log('worker: BullMQ schedulers registered');
} else {
  console.log('worker: no REDIS_URL, running in-process loop');
  await run('sync');
  const loop = async () => {
    await run('tick').catch((e) => console.error(e));
    setTimeout(loop, 60_000);
  };
  void loop();
}
