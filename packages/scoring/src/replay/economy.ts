import type { EconomyConfig } from '@ff/shared';
import type { ScenarioSummary } from './sim.js';

export interface EconomyRow {
  label: string;
  coinsPerGameweek: number;
  weeksPerPlayerPack: number;
  weeksPerSwap: number;
  weeksPerSquadPack: number;
  /** New cards per gameweek from Coins alone, spending everything on player packs. */
  coinCardsPerWeek: number;
  /** Including the weekly free pack (one card) for players who confirm their actions. */
  cardsPerWeekWithFreePack: number;
  seasonPoints38: number;
  /** Gameweek (1-38) at which the average player reaches each milestone; null = not reached. */
  milestoneGameweek: Record<number, number | null>;
}

export function economyRows(
  summaries: ScenarioSummary[],
  eco: EconomyConfig,
  firstGameweek: number,
): EconomyRow[] {
  const p = eco.prices_coins;
  return summaries.map((s) => {
    const c = s.coinsPerGameweek;
    const milestoneGameweek: Record<number, number | null> = {};
    for (const m of eco.season_milestones) {
      // Simulated weeks start at `firstGameweek`; earlier weeks are extrapolated at the average rate.
      const lead = (firstGameweek - 1) * s.perGameweek;
      let gw: number | null = null;
      for (let w = 1; w <= 38; w++) {
        const cum =
          w < firstGameweek
            ? w * s.perGameweek
            : lead + (s.cumulative[w - firstGameweek] ?? s.cumulative.at(-1)!);
        if (cum >= m.season_points) {
          gw = w;
          break;
        }
      }
      milestoneGameweek[m.season_points] = gw;
    }
    return {
      label: s.label,
      coinsPerGameweek: c,
      weeksPerPlayerPack: p.player_pack / c,
      weeksPerSwap: p.card_swap / c,
      weeksPerSquadPack: p.squad_pack / c,
      coinCardsPerWeek: c / p.player_pack,
      cardsPerWeekWithFreePack: 1 + c / p.player_pack,
      seasonPoints38: s.perGameweek * 38,
      milestoneGameweek,
    };
  });
}
