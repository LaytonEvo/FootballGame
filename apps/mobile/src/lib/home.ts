import type { Position, Rarity } from '@ff/shared';

export interface HomeData {
  serverTime: string;
  mode: 'pre_deadline' | 'locked' | 'live' | 'finalised' | 'off_season';
  gameweek: {
    id: string;
    number: number;
    status: string;
    deadlineAt: string;
    firstKickoffAt: string;
    finaliseAt: string;
  } | null;
  next: { id: string; number: number; deadlineAt: string; firstKickoffAt: string } | null;
  picks: { confirmed: boolean; carriedOver: boolean; setCount: number };
  squad: {
    slot: number;
    name: string;
    position: Position;
    rarity: Rarity;
    shirtNumber: number | null;
    clubCode: string | null;
  }[];
  sealedPacks: { id: string; type: string; source: string; grantedAt: string }[];
  score: { total: number; provisional: boolean; actionsLanded: number; actionsPicked: number } | null;
  coins?: { balance: number; nextPackPrice: number; toNextPack: number };
  league?: {
    id: string;
    name: string;
    rank: number;
    size: number;
    points: number;
    gapAbove: number | null;
  } | null;
  lastRecap?: { gameweekId: string; number: number; points: number; landed: number; picked: number } | null;
  live?: LiveData | null;
}

export interface LiveLine {
  actionId: string;
  label: string;
  state: 'pending' | 'landed' | 'missed' | 'void';
  points: number;
  potential: number;
  bold: boolean;
  explanation: string;
}
export interface LiveSlot {
  slot: number;
  name: string;
  position: Position;
  rarity: Rarity;
  shirtNumber: number | null;
  role: string;
  points: number;
  matchLabel: string;
  captain: boolean;
  lines: LiveLine[];
}
export interface LiveData {
  total: number;
  provisional: boolean;
  slots: LiveSlot[];
  lastLanded: { name: string; label: string; points: number } | null;
  leagueMoves: { leagueId: string; name: string; rank: number; previousRank: number | null }[];
}
