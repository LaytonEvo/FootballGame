/* Load config/scoring.v0.2.json and config/economy.v0.1.json into the database (idempotent).
 *   pnpm seed                 # configs only
 *   pnpm seed --dataset       # also clubs, players and the 2025/26 fixture list (dev replay data) */
import { createDb } from './db/client.js';
import { seedConfigs } from './services/config.js';

const { db, close } = await createDb(
  process.env.DATABASE_URL ?? new URL('../.data/pglite', import.meta.url).pathname,
);
await seedConfigs(db);
console.log('Seeded scoring and economy configs');
if (process.argv.includes('--dataset')) {
  const { seedFromDataset } = await import('./seed-dataset.js');
  await seedFromDataset(db);
}
await close();
