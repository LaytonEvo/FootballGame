import { buildApp } from './app.js';
import { systemClock } from './clock.js';
import { createDb } from './db/client.js';
import { seedConfigs } from './services/config.js';

const { db } = await createDb(
  process.env.DATABASE_URL ?? new URL('../.data/pglite', import.meta.url).pathname,
);
await seedConfigs(db);
const app = await buildApp({ db, clock: systemClock });
const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });
