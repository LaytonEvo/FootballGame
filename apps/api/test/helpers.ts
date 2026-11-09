import { FakeClock } from '../src/clock.js';
import { createDb } from '../src/db/client.js';
import { seedConfigs } from '../src/services/config.js';

export async function testDb() {
  const { db, close } = await createDb('memory://');
  await seedConfigs(db);
  return { db, close };
}

export async function testCtx(start = '2026-08-01T12:00:00Z') {
  const { db, close } = await testDb();
  const clock = new FakeClock(new Date(start));
  return { db, close, clock };
}
