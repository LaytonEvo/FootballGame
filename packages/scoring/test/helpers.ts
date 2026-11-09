import { readFileSync } from 'node:fs';
import type { PlayerMatchStats, Position, Rarity } from '@ff/shared';
import { parseScoringConfig } from '@ff/shared';
import { compileRules } from '../src/index.js';
import type { Selection, SlotPick } from '../src/index.js';

export const rawConfig = JSON.parse(
  readFileSync(new URL('../../../config/scoring.v0.2.json', import.meta.url), 'utf8'),
);
export const rules = compileRules(parseScoringConfig(rawConfig));

let fx = 0;
export function match(playerId: string, s: Partial<PlayerMatchStats> = {}): PlayerMatchStats {
  return {
    playerId,
    fixtureId: s.fixtureId ?? `f${++fx}`,
    status: 'finished',
    minutes: 90,
    goals: 0,
    assists: 0,
    cleanSheet: false,
    goalsConceded: 1,
    saves: 0,
    penaltiesSaved: 0,
    yellowCards: 0,
    redCards: 0,
    ...s,
  };
}

export const pick = (
  playerId: string,
  position: Position,
  actions: string[],
  rarity: Rarity = 'gold',
): SlotPick => ({
  playerId,
  position,
  rarity,
  actions,
});

/** A valid baseline selection: gk, def, m1, m2, fwd + sub (MID). */
export function baseSelection(over: Partial<Selection> = {}): Selection {
  return {
    starters: [
      pick('gk', 'GK', ['saves_3plus']),
      pick('def', 'DEF', ['clean_sheet']),
      pick('m1', 'MID', ['plays_90']),
      pick('m2', 'MID', ['goal_involvement']),
      pick('fwd', 'FWD', ['goal']),
    ],
    sub: pick('sub', 'MID', ['assist']),
    captain: null,
    bold: null,
    ...over,
  };
}

export const statsMap = (...ms: PlayerMatchStats[]) => {
  const m = new Map<string, PlayerMatchStats[]>();
  for (const x of ms) m.set(x.playerId, [...(m.get(x.playerId) ?? []), x]);
  return m;
};

/** Everyone in the base selection plays 90 and does nothing. */
export const quietWeek = () =>
  ['gk', 'def', 'm1', 'm2', 'fwd', 'sub'].map((id) => match(id, { minutes: 80 }));
