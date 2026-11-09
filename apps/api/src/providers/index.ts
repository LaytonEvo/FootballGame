import type { Clock } from '../clock.js';
import { CommercialProvider } from './commercial.js';
import { FplDatasetProvider } from './fpl-dataset.js';
import type { DataProvider } from './types.js';

export * from './types.js';
export { CommercialProvider, FplDatasetProvider };

export function providerFromEnv(clock: Clock): DataProvider {
  return process.env.DATA_PROVIDER === 'commercial'
    ? new CommercialProvider()
    : new FplDatasetProvider({ clock });
}
