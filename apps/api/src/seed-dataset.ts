import { systemClock } from './clock.js';
import type { Db } from './db/client.js';
import { FplDatasetProvider } from './providers/fpl-dataset.js';
import { syncReferenceData } from './services/ingest.js';
import { LocalOtpService } from './services/otp.js';
import { MemoryPushSender } from './services/push.js';

export async function seedFromDataset(db: Db) {
  const ctx = {
    db,
    clock: systemClock,
    provider: new FplDatasetProvider({ clock: systemClock }),
    otp: new LocalOtpService(db, systemClock),
    push: new MemoryPushSender(),
  };
  const res = await syncReferenceData(ctx);
  console.log(`Seeded from the 2025/26 dataset (dates +364 days): ${JSON.stringify(res)}`);
}
