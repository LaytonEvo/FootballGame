import type { DataProvider } from './types.js';

/** Placeholder until the commercial data contract is signed. Every call fails loudly. */
export class CommercialProvider implements DataProvider {
  readonly name = 'commercial';
  private fail(): never {
    throw new Error(
      'CommercialProvider is not configured: no data contract yet. Use DATA_PROVIDER=fpl-dataset.',
    );
  }
  clubs = async () => this.fail();
  squads = async () => this.fail();
  fixtures = async () => this.fail();
  liveMatchStats = async () => this.fail();
  finalMatchStats = async () => this.fail();
  transfers = async () => this.fail();
}
