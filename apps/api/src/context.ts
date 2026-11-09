import type { Clock } from './clock.js';
import type { Db } from './db/client.js';

export interface AppContext {
  db: Db;
  clock: Clock;
}
