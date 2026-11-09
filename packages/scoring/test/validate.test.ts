import { describe, expect, it } from 'vitest';
import { compileRules, validateSelection } from '../src/index.js';
import { parseScoringConfig } from '@ff/shared';
import { baseSelection, pick, rawConfig, rules } from './helpers.js';

const codes = (s: ReturnType<typeof baseSelection>) => validateSelection(rules, s).map((e) => e.code);
const withSlot = (i: number, actions: string[]) =>
  baseSelection({ starters: baseSelection().starters.map((p, j) => (j === i ? { ...p, actions } : p)) });

describe('selection validation', () => {
  it('accepts the baseline', () => expect(codes(baseSelection())).toEqual([]));
  it('min 1 action per starter (draft mode allows empty)', () => {
    expect(codes(withSlot(0, []))).toEqual(['too_few_actions']);
    expect(validateSelection(rules, withSlot(0, []), { requireComplete: false })).toEqual([]);
  });
  it('max 2 actions per player', () =>
    expect(codes(withSlot(4, ['goal', 'assist', 'plays_90']))).toContain('too_many_actions'));
  it('no two actions from the same overlap group', () => {
    expect(codes(withSlot(4, ['goal', 'goal_involvement']))).toEqual(['overlap_group']);
    expect(codes(withSlot(0, ['saves_3plus', 'saves_5plus']))).toEqual(['overlap_group']);
    expect(codes(withSlot(4, ['goal', 'assist']))).toEqual([]);
  });
  it('max one chaos action per squad, including the sub', () => {
    const sel = baseSelection({
      starters: baseSelection().starters.map((p, j) => (j === 2 ? { ...p, actions: ['yellow_card'] } : p)),
      sub: pick('sub', 'MID', ['yellow_card']),
    });
    expect(codes(sel)).toEqual(['too_many_chaos']);
  });
  it('action must exist for the position and feed', () => {
    expect(codes(withSlot(0, ['goal']))).toEqual(['action_not_for_position']);
    expect(codes(withSlot(0, ['nope']))).toEqual(['unknown_action']);
    expect(codes(withSlot(2, ['tackles_3plus']))).toEqual(['advanced_feed_action']);
    const adv = compileRules(parseScoringConfig({ ...rawConfig, mvp_basic_feed_only: false }));
    expect(validateSelection(adv, withSlot(2, ['tackles_3plus']))).toEqual([]);
  });
  it('squad shape and unique players', () => {
    const swapped = baseSelection();
    swapped.starters = [swapped.starters[1]!, swapped.starters[0]!, ...swapped.starters.slice(2)];
    expect(codes(swapped)).toContain('squad_shape');
    expect(codes(baseSelection({ sub: pick('gk', 'GK', ['saves_3plus']) }))).toContain('duplicate_player');
  });
  it('captain must be a starter; bold must be a picked action', () => {
    expect(codes(baseSelection({ captain: 5 }))).toEqual(['bad_captain']);
    expect(codes(baseSelection({ bold: { slot: 4, actionId: 'assist' } }))).toEqual(['bold_not_picked']);
    expect(codes(baseSelection({ bold: { slot: 5, actionId: 'assist' } }))).toEqual([]);
  });
});
