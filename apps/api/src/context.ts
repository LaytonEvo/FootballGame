import type { Clock } from './clock.js';
import type { Db } from './db/client.js';
import type { DataProvider } from './providers/types.js';
import type { OtpService } from './services/otp.js';

export interface AppContext {
  db: Db;
  clock: Clock;
  provider: DataProvider;
  otp: OtpService;
}
