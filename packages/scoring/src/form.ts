import type { Position, PlayerMatchStats } from '@ff/shared';
import { aggregate } from './aggregate.js';
import { RESOLVERS } from './resolvers.js';
import type { RuleSet } from './rules.js';

export interface FormHint {
  actionId: string;
  hits: number;
  of: number;
  text: string;
}

const SHORT: Record<string, string> = {
  goal: 'Scored',
  goals_2plus: '2+ goals',
  hat_trick: 'Hat-trick',
  assist: 'Assist',
  goal_involvement: 'Goal or assist',
  clean_sheet: 'Clean sheet',
  saves_3plus: '3+ saves',
  saves_5plus: '5+ saves',
  penalty_save: 'Penalty save',
  tackles_3plus: '3+ tackles',
  cbi_5plus: '5+ CBI',
  def_contribution: 'Def. contribution',
  plays_90: 'Full 90',
  yellow_card: 'Booked',
  scores_and_booked: 'Scored and booked',
};

/**
 * "3+ tackles in 3 of last 5": how often the action would have landed in the player's recent gameweeks.
 * `recent` is one array of match stats per gameweek, most recent first; gameweeks without a valid match
 * are skipped.
 */
export function formHint(
  rules: RuleSet,
  actionId: string,
  position: Position,
  recent: readonly (readonly PlayerMatchStats[])[],
  window = 5,
): FormHint {
  const resolver = RESOLVERS[actionId];
  if (!resolver) throw new Error(`Unknown action ${actionId}`);
  let hits = 0;
  let of = 0;
  for (const gw of recent) {
    if (of >= window) break;
    const g = aggregate(gw, rules.cleanSheetMinMinutes);
    if (g.noValidMatch || !g.finished) continue;
    const c = resolver.count(g, position);
    if (c === null) continue;
    of += 1;
    if (c > 0) hits += 1;
  }
  return { actionId, hits, of, text: `${SHORT[actionId] ?? actionId} in ${hits} of last ${of}` };
}
