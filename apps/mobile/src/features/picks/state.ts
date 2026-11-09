import type { Position, Rarity } from '@ff/shared';
import type { RuleSet, Selection } from '@ff/scoring';
import { potentialPoints, validateSelection } from '@ff/scoring';

export interface SelectionInput {
  actions: string[][];
  captain: number | null;
  bold: { slot: number; actionId: string } | null;
}

export interface SlotMeta {
  slot: number;
  playerId: string;
  position: Position;
  rarity: Rarity;
}

export const SUB_SLOT = 5;

export function toSelection(slots: SlotMeta[], input: SelectionInput): Selection {
  const pick = (m: SlotMeta) => ({
    playerId: m.playerId,
    position: m.position,
    rarity: m.rarity,
    actions: input.actions[m.slot] ?? [],
  });
  const sub = slots.find((s) => s.slot === SUB_SLOT);
  return {
    starters: slots.filter((s) => s.slot < SUB_SLOT).map(pick),
    sub: sub ? pick(sub) : null,
    captain: input.captain,
    bold: input.bold,
  };
}

export type ToggleResult = { input: SelectionInput; message?: string };

/**
 * Tap an action in the sheet. Selected → removed. A same-group action already picked is replaced. With two
 * picked, the second is replaced. A second chaos action anywhere in the squad is refused with a message.
 */
export function toggleAction(
  rules: RuleSet,
  slots: SlotMeta[],
  input: SelectionInput,
  slot: number,
  actionId: string,
): ToggleResult {
  const meta = slots.find((s) => s.slot === slot);
  const a = meta && rules.byPosition[meta.position].get(actionId);
  if (!meta || !a) return { input, message: 'Not available for this player' };
  const current = input.actions[slot] ?? [];
  let next: string[];
  if (current.includes(actionId)) {
    next = current.filter((x) => x !== actionId);
  } else {
    if (a.chaos) {
      const chaosElsewhere = input.actions.some((acts, i) =>
        acts.some((id) => {
          const pos = slots.find((s) => s.slot === i)?.position;
          return pos && rules.byPosition[pos].get(id)?.chaos && !(i === slot && current.includes(id));
        }),
      );
      if (chaosElsewhere) return { input, message: 'Only one chaos action per squad' };
    }
    next = current.filter((id) => rules.byPosition[meta.position].get(id)?.overlapGroup !== a.overlapGroup);
    if (next.length >= rules.maxActions) next = next.slice(0, rules.maxActions - 1);
    next = [...next, actionId];
  }
  const actions = input.actions.map((acts, i) => (i === slot ? next : acts));
  const bold =
    input.bold && input.bold.slot === slot && !next.includes(input.bold.actionId) ? null : input.bold;
  return { input: { ...input, actions, bold } };
}

export const setCaptain = (input: SelectionInput, slot: number): SelectionInput => ({
  ...input,
  captain: slot < SUB_SLOT ? (input.captain === slot ? null : slot) : input.captain,
});

/** One bold action per gameweek: marking a new one moves it. */
export function toggleBold(input: SelectionInput, slot: number, actionId: string): SelectionInput {
  const on = input.bold?.slot === slot && input.bold.actionId === actionId;
  if (!on && !(input.actions[slot] ?? []).includes(actionId)) return input;
  return { ...input, bold: on ? null : { slot, actionId } };
}

export function summary(rules: RuleSet, slots: SlotMeta[], input: SelectionInput) {
  const sel = toSelection(slots, input);
  const errors = validateSelection(rules, sel);
  const starters = slots.filter((s) => s.slot < SUB_SLOT);
  const set = starters.filter((s) => (input.actions[s.slot] ?? []).length > 0).length;
  return {
    errors,
    canConfirm: errors.length === 0,
    potential: potentialPoints(rules, sel),
    setCount: set,
    total: starters.length,
  };
}

/** "−8 if not": the bold miss penalty shown on the toggle. */
export const boldPenalty = (rules: RuleSet, points: number) => Math.ceil(points * rules.boldPenaltyFraction);
