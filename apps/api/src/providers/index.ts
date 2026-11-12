import type { Clock } from '../clock.js';
import { CommercialProvider } from './commercial.js';
import { FplDatasetProvider } from './fpl-dataset.js';
import { FplSeasonProvider } from './fpl-season.js';
import type { DataProvider } from './types.js';

export * from './types.js';
export { CommercialProvider, FplDatasetProvider, FplSeasonProvider };

export function providerFromEnv(clock: Clock): DataProvider {
  switch (process.env.DATA_PROVIDER) {
    case 'commercial':
      return new CommercialProvider();
    case 'fpl-season': // current season from the public dataset (closed test)
      return new FplSeasonProvider(clock);
    default: // 2025/26 replay shifted a year (development and tests)
      return new FplDatasetProvider({ clock });
  }
}
