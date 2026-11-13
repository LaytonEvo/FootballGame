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
  /** Pre-deadline nudge, e.g. "0 mins in last 2 gameweeks". */
  warning: string | null;
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
  edition?: CardEdition | null;
}

/** A limited, numbered edition card (earned only). */
export interface CardEdition {
  name: string;
  serial: number;
  supply: number;
}

/** A card as GET /cards and the trade endpoints return it. */
export interface OwnedCard {
  card: {
    id: string;
    userId?: string;
    playerId: string;
    rarity: Rarity;
    rating: number;
    level: number;
    active: boolean;
    inactiveReason: string | null;
    serial: number | null;
  };
  player: { name: string; position: Position };
  clubCode: string | null;
  edition: { name: string; supply: number } | null;
}

export const editionOf = (c: OwnedCard): CardEdition | null =>
  c.edition && c.card.serial
    ? { name: c.edition.name, serial: c.card.serial, supply: c.edition.supply }
    : null;
export interface Pack {
  id: string;
  type: string;
  source: string;
  status: 'sealed' | 'opened';
  rarity: Rarity | null;
  grantedAt: string;
  odds: Partial<Record<Rarity, number>>;
  oddsVersion: string;
  oddsNote?: string | null;
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
