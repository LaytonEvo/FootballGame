import type { Position } from '@ff/shared';
import type { ActionForPosition, RuleSet } from './rules.js';
import { availableActions } from './rules.js';
import type { Selection, SlotPick } from './selection.js';
import { allSlots } from './selection.js';

const AUTO_TIERS = new Set(['likely', 'possible']);

/** Likely/possible actions for a position, best average points first (ties: config order). */
export function autoCandidates(rules: RuleSet, position: Position): ActionForPosition[] {
  return availableActions(rules, position)
    .filter((a) => !a.chaos && AUTO_TIERS.has(a.tier))
    .map((a, i) => ({ a, i }))
    .sort((x, y) => y.a.expected - x.a.expected || x.i - y.i)
    .map((x) => x.a);
}

function fillPick(rules: RuleSet, pick: SlotPick): SlotPick {
  const actions = [...pick.actions];
  const groups = new Set(actions.map((id) => rules.byPosition[pick.position].get(id)?.overlapGroup));
  for (const a of autoCandidates(rules, pick.position)) {
    if (actions.length >= rules.maxActions) break;
    if (actions.includes(a.id) || (rules.noOverlap && groups.has(a.overlapGroup))) continue;
    actions.push(a.id);
    groups.add(a.overlapGroup);
  }
  return { ...pick, actions };
}

/**
 * Auto-pick: fill every empty action slot with the highest-average likely/possible action that does not
 * clash with what is already there. Existing picks are kept. Sets a captain if none is set (highest
 * expected points, rarity-adjusted). Never adds chaos actions or a bold action.
 */
export function autoPick(rules: RuleSet, sel: Selection): Selection {
  const starters = sel.starters.map((p) => fillPick(rules, p));
  const sub = sel.sub ? fillPick(rules, sel.sub) : null;
  let captain = sel.captain;
  if (captain === null) {
    let best = -Infinity;
    starters.forEach((p, i) => {
      const ev = p.actions.reduce((s, id) => s + (rules.byPosition[p.position].get(id)?.expected ?? 0), 0);
      const v = ev * rules.rarityMultiplier[p.rarity];
      if (v > best) {
        best = v;
        captain = i;
      }
    });
  }
  return { ...sel, starters, sub, captain };
}

/**
 * Carry last gameweek's actions onto the current squad (used for "Same as last week" and for a missed
 * deadline). Actions follow the player, wherever they sit now; anything no longer valid is dropped, then
 * Auto-pick fills the gaps so the selection is always complete.
 */
export function carryOver(rules: RuleSet, previous: Selection | null, current: Selection): Selection {
  if (!previous) return autoPick(rules, current);
  const prevByPlayer = new Map(allSlots(previous).map(({ slot, pick }) => [pick.playerId, { slot, pick }]));
  const carry = (p: SlotPick): SlotPick => {
    const prev = prevByPlayer.get(p.playerId);
    if (!prev) return { ...p, actions: [] };
    const allowed = rules.byPosition[p.position];
    const actions = prev.pick.actions.filter((id) => {
      const a = allowed.get(id);
      return a && (!rules.basicFeedOnly || a.feed === 'basic');
    });
    return { ...p, actions: actions.slice(0, rules.maxActions) };
  };
  const starters = current.starters.map(carry);
  const sub = current.sub ? carry(current.sub) : null;

  // Drop chaos actions beyond the cap (keep the earliest slot's).
  let chaos = 0;
  for (const p of [...starters, ...(sub ? [sub] : [])]) {
    p.actions = p.actions.filter((id) => {
      if (!rules.byPosition[p.position].get(id)?.chaos) return true;
      chaos += 1;
      return chaos <= rules.maxChaos;
    });
  }

  const prevCaptainId = previous.captain === null ? null : previous.starters[previous.captain]?.playerId;
  const captainIdx = starters.findIndex((p) => p.playerId === prevCaptainId);
  let bold: Selection['bold'] = null;
  if (previous.bold) {
    const boldPlayer =
      previous.bold.slot === 5 ? previous.sub?.playerId : previous.starters[previous.bold.slot]?.playerId;
    const all = [...starters, ...(sub ? [sub] : [])];
    const idx = all.findIndex(
      (p) => p.playerId === boldPlayer && p.actions.includes(previous.bold!.actionId),
    );
    if (idx >= 0) bold = { slot: idx, actionId: previous.bold.actionId };
  }
  return autoPick(rules, { starters, sub, captain: captainIdx >= 0 ? captainIdx : null, bold });
}
