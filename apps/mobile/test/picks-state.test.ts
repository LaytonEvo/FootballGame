import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseScoringConfig } from '@ff/shared';
import { compileRules } from '@ff/scoring';
import type { SelectionInput, SlotMeta } from '../src/features/picks/state';
import { boldPenalty, setCaptain, summary, toggleAction, toggleBold } from '../src/features/picks/state';
import { countdown, plateName } from '../src/lib/format';

const rules = compileRules(
  parseScoringConfig(
    JSON.parse(readFileSync(new URL('../../../config/scoring.v0.2.json', import.meta.url), 'utf8')),
  ),
);
const slots: SlotMeta[] = [
  { slot: 0, playerId: 'gk', position: 'GK', rarity: 'gold' },
  { slot: 1, playerId: 'def', position: 'DEF', rarity: 'gold' },
  { slot: 2, playerId: 'm1', position: 'MID', rarity: 'gold' },
  { slot: 3, playerId: 'm2', position: 'MID', rarity: 'gold' },
  { slot: 4, playerId: 'fwd', position: 'FWD', rarity: 'elite' },
];
const empty = (): SelectionInput => ({ actions: [[], [], [], [], []], captain: null, bold: null });

describe('pick screen state', () => {
  it('adds, removes and replaces same-group actions', () => {
    let s = toggleAction(rules, slots, empty(), 4, 'goal').input;
    s = toggleAction(rules, slots, s, 4, 'goal_involvement').input;
    expect(s.actions[4]).toEqual(['goal_involvement']); // same overlap group replaced
    s = toggleAction(rules, slots, s, 4, 'assist').input;
    s = toggleAction(rules, slots, s, 4, 'plays_90').input;
    expect(s.actions[4]).toEqual(['goal_involvement', 'plays_90']); // max two
    s = toggleAction(rules, slots, s, 4, 'plays_90').input;
    expect(s.actions[4]).toEqual(['goal_involvement']);
  });
  it('refuses a second chaos action in the squad', () => {
    const s = toggleAction(rules, slots, empty(), 2, 'yellow_card').input;
    const r = toggleAction(rules, slots, s, 3, 'yellow_card');
    expect(r.message).toMatch(/one chaos/);
    expect(r.input.actions[3]).toEqual([]);
  });
  it('captain and bold', () => {
    let s = toggleAction(rules, slots, empty(), 4, 'goal').input;
    s = setCaptain(s, 4);
    expect(s.captain).toBe(4);
    s = toggleBold(s, 4, 'goal');
    expect(s.bold).toEqual({ slot: 4, actionId: 'goal' });
    s = toggleAction(rules, slots, s, 4, 'goal').input;
    expect(s.bold).toBeNull(); // removing the action clears bold
    expect(boldPenalty(rules, 15)).toBe(8);
  });
  it('summary counts set players and potential points', () => {
    let s = empty();
    for (const [slot, a] of [
      [0, 'saves_3plus'],
      [1, 'clean_sheet'],
      [2, 'plays_90'],
      [3, 'plays_90'],
      [4, 'goal'],
    ] as const)
      s = toggleAction(rules, slots, s, slot, a).input;
    const sum = summary(rules, slots, s);
    expect(sum.canConfirm).toBe(true);
    expect(sum.setCount).toBe(5);
    expect(sum.potential).toBe(3 + 8 + 3 + 3 + 5); // elite 5 × 0.9 = 4.5 → 5
  });
});

describe('format', () => {
  it('countdown', () => {
    const now = new Date('2026-08-14T12:00:00Z');
    expect(countdown(new Date('2026-08-15T16:12:00Z'), now)).toBe('1d 4h 12m');
    expect(countdown(new Date('2026-08-14T12:05:07Z'), now)).toBe('5m 07s');
    expect(countdown(new Date('2026-08-14T11:00:00Z'), now)).toBe('0m 00s');
  });
  it('plate name', () => expect(plateName('Bukayo Saka')).toBe('Saka'));
});
