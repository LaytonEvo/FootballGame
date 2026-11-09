import type { Position, Rarity, Tier } from '@ff/shared';

export interface PickAction {
  id: string;
  label: string;
  tier: Tier;
  tierLabel: string;
  overlapGroup: string;
  chaos: boolean;
  points: number;
  hint: string | null;
}
export interface PickSlot {
  slot: number;
  cardId: string;
  playerId: string;
  name: string;
  shirtNumber: number | null;
  position: Position;
  rarity: Rarity;
  clubCode: string | null;
  fixtureLabel: string;
  fixtures: { label: string; kickoffAt: string | null; status: string }[];
  actions: PickAction[];
}
export interface SelectionInput {
  actions: string[][];
  captain: number | null;
  bold: { slot: number; actionId: string } | null;
}
export interface PickScreen {
  gameweek: { id: string; number: number; deadlineAt: string; status: string; scoringVersion: string };
  serverTime: string;
  locked: boolean;
  confirmedAt: string | null;
  carriedOver: boolean;
  slots: PickSlot[];
  selection: SelectionInput;
  potentialPoints: number;
  hasLastWeek: boolean;
}
export interface PackCard {
  cardId: string;
  playerId: string;
  name: string;
  position: Position;
  clubCode: string | null;
  rarity: Rarity;
  rating: number;
  duplicate: boolean;
  level: number;
}
export interface Pack {
  id: string;
  type: string;
  source: string;
  status: 'sealed' | 'opened';
  rarity: Rarity | null;
  grantedAt: string;
  odds: Partial<Record<Rarity, number>>;
  oddsVersion: string;
}
export interface SquadCard {
  slot: number;
  cardId: string;
  playerId: string;
  name: string;
  position: Position;
  clubCode: string | null;
  rarity: Rarity;
  rating: number;
  level: number;
  active: boolean;
}

/** Short chip labels for the pitch (mockup copy). */
export const SHORT_LABEL: Record<string, string> = {
  goal: 'Goal',
  goals_2plus: '2+ goals',
  hat_trick: 'Hat-trick',
  assist: 'Assist',
  goal_involvement: 'Goal inv.',
  clean_sheet: 'Clean sheet',
  saves_3plus: '3+ saves',
  saves_5plus: '5+ saves',
  penalty_save: 'Pen save',
  tackles_3plus: '3+ tackles',
  cbi_5plus: '5+ CBI',
  def_contribution: 'Def. actions',
  plays_90: 'Full 90',
  yellow_card: 'Yellow',
  scores_and_booked: 'Score + book',
};
export const shirtLabel = (s: { shirtNumber: number | null; position: Position }) =>
  s.shirtNumber ? String(s.shirtNumber) : s.position;
