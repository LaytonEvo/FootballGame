/** "Bukayo Saka" → "Saka" (name plates and pushes). */
export function plateName(full: string): string {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : full;
}

/** Short action labels for chips, recaps and share cards. */
export const SHORT_LABEL: Record<string, string> = {
  goal: 'goal',
  goals_2plus: '2+ goals',
  hat_trick: 'hat-trick',
  assist: 'assist',
  goal_involvement: 'goal involvement',
  clean_sheet: 'clean sheet',
  saves_3plus: '3+ saves',
  saves_5plus: '5+ saves',
  penalty_save: 'penalty save',
  tackles_3plus: '3+ tackles',
  cbi_5plus: '5+ CBI',
  def_contribution: 'defensive actions',
  plays_90: 'full 90',
  yellow_card: 'yellow card',
  scores_and_booked: 'scores and booked',
};
