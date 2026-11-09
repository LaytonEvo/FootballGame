import { describe, expect, it } from 'vitest';
import {
  autoCandidates,
  autoPick,
  carryOver,
  formHint,
  mulberry32,
  validateSelection,
} from '../src/index.js';
import { baseSelection, match, pick, rules } from './helpers.js';

describe('auto-pick', () => {
  it('fills every empty slot with likely/possible non-chaos actions, valid result', () => {
    const empty = baseSelection({
      starters: baseSelection().starters.map((p) => ({ ...p, actions: [] })),
      sub: { ...baseSelection().sub!, actions: [] },
    });
    const sel = autoPick(rules, empty);
    expect(validateSelection(rules, sel)).toEqual([]);
    for (const p of [...sel.starters, sel.sub!]) {
      expect(p.actions).toHaveLength(2);
      for (const id of p.actions) {
        const a = rules.byPosition[p.position].get(id)!;
        expect(['likely', 'possible']).toContain(a.tier);
        expect(a.feed).toBe('basic');
      }
    }
    expect(sel.captain).not.toBeNull();
    expect(sel.bold).toBeNull();
  });
  it('ranks by average points per pick', () => {
    const fwd = autoCandidates(rules, 'FWD').map((a) => a.id);
    expect(fwd[0]).toBe('plays_90'); // 4 × 0.40 = 1.61 beats goal 5 × 0.256 = 1.28
  });
  it('keeps existing picks and avoids overlap', () => {
    const sel = autoPick(rules, baseSelection());
    expect(sel.starters[4]!.actions[0]).toBe('goal');
    expect(sel.starters[4]!.actions).not.toContain('goal_involvement');
  });
});

describe('carry over / same as last week', () => {
  it('actions follow the player; new players get auto-picked', () => {
    const prev = baseSelection({ captain: 4, bold: { slot: 4, actionId: 'goal' } });
    const current = baseSelection();
    current.starters[3] = pick('new-mid', 'MID', []);
    const sel = carryOver(rules, prev, current);
    expect(sel.starters[4]!.actions[0]).toBe('goal');
    expect(sel.captain).toBe(4);
    expect(sel.bold).toEqual({ slot: 4, actionId: 'goal' });
    expect(sel.starters[3]!.actions.length).toBe(2);
    expect(validateSelection(rules, sel)).toEqual([]);
  });
  it('with no previous week behaves like auto-pick', () => {
    const sel = carryOver(rules, null, baseSelection());
    expect(validateSelection(rules, sel)).toEqual([]);
  });
});

describe('form hint', () => {
  it('counts hits over the last five gameweeks with a valid match', () => {
    const recent = [
      [match('p', { saves: 4 })],
      [],
      [match('p', { saves: 1 })],
      [match('p', { saves: 3 })],
      [match('p', { saves: 0 })],
      [match('p', { saves: 6 })],
      [match('p', { saves: 6 })],
    ];
    expect(formHint(rules, 'saves_3plus', 'GK', recent).text).toBe('3+ saves in 3 of last 5');
  });
});

describe('rng', () => {
  it('is reproducible from a seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
