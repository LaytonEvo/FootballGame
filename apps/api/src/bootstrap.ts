import { systemClock } from './clock.js';
import type { AppContext } from './context.js';
import { createDb } from './db/client.js';
import { providerFromEnv } from './providers/index.js';
import { seedConfigs } from './services/config.js';
import { LocalOtpService, TwilioVerifyOtpService } from './services/otp.js';

/** Build the runtime context from the environment (API and worker). */
export async function createContext(): Promise<AppContext> {
  const { db } = await createDb(
    process.env.DATABASE_URL ?? new URL('../.data/pglite', import.meta.url).pathname,
  );
  await seedConfigs(db);
  const otp = process.env.TWILIO_VERIFY_SERVICE_SID
    ? new TwilioVerifyOtpService()
    : new LocalOtpService(db, systemClock, (m) => console.log(m));
  return { db, clock: systemClock, provider: providerFromEnv(systemClock), otp };
}
