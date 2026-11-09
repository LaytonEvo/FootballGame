import { systemClock } from './clock.js';
import type { AppContext } from './context.js';
import { createDb } from './db/client.js';
import { providerFromEnv } from './providers/index.js';
import { seedConfigs } from './services/config.js';
import { BypassOtpService, LocalOtpService, TwilioVerifyOtpService } from './services/otp.js';
import { ExpoPushSender, MemoryPushSender } from './services/push.js';

/** Build the runtime context from the environment (API and worker). */
export async function createContext(): Promise<AppContext> {
  const { db } = await createDb(
    process.env.DATABASE_URL ?? new URL('../.data/pglite', import.meta.url).pathname,
  );
  await seedConfigs(db);
  const bypass = process.env.OTP_BYPASS_CODE;
  if (bypass) console.warn('SMS sign-in is BYPASSED (OTP_BYPASS_CODE is set). Testing only.');
  const otp = bypass
    ? new BypassOtpService(bypass)
    : process.env.TWILIO_VERIFY_SERVICE_SID
      ? new TwilioVerifyOtpService()
      : new LocalOtpService(db, systemClock, (m) => console.log(m));
  const push = process.env.PUSH_PROVIDER === 'none' ? new MemoryPushSender() : new ExpoPushSender();
  return { db, clock: systemClock, provider: providerFromEnv(systemClock), otp, push };
}
