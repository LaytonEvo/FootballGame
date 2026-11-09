import { STARTER_SHAPE } from '@ff/shared';
import type { RuleSet } from './rules.js';
import type { Selection } from './selection.js';
import { SUB_SLOT, allSlots } from './selection.js';

export type SelectionErrorCode =
  | 'squad_shape'
  | 'duplicate_player'
  | 'too_few_actions'
  | 'too_many_actions'
  | 'unknown_action'
  | 'action_not_for_position'
  | 'advanced_feed_action'
  | 'duplicate_action'
  | 'overlap_group'
  | 'too_many_chaos'
  | 'bad_captain'
  | 'bold_not_picked';

export interface SelectionError {
  code: SelectionErrorCode;
  slot?: number;
  actionId?: string;
  message: string;
}

export interface ValidateOptions {
  /** When false, slots may have fewer than the minimum actions (draft state). Default true. */
  requireComplete?: boolean;
}

export function validateSelection(
  rules: RuleSet,
  sel: Selection,
  opts: ValidateOptions = {},
): SelectionError[] {
  const requireComplete = opts.requireComplete ?? true;
  const errors: SelectionError[] = [];
  const err = (e: SelectionError) => errors.push(e);

  if (sel.starters.length !== STARTER_SHAPE.length) {
    err({
      code: 'squad_shape',
      message: `Need ${STARTER_SHAPE.length} starters, got ${sel.starters.length}`,
    });
  }
  sel.starters.forEach((p, i) => {
    if (STARTER_SHAPE[i] && p.position !== STARTER_SHAPE[i]) {
      err({
        code: 'squad_shape',
        slot: i,
        message: `Slot ${i} must be a ${STARTER_SHAPE[i]}, got ${p.position}`,
      });
    }
  });

  const seen = new Set<string>();
  let chaos = 0;
  for (const { slot, pick } of allSlots(sel)) {
    if (seen.has(pick.playerId))
      err({ code: 'duplicate_player', slot, message: `${pick.playerId} picked twice` });
    seen.add(pick.playerId);

    if (requireComplete && pick.actions.length < rules.minActions) {
      err({ code: 'too_few_actions', slot, message: `Pick at least ${rules.minActions} action(s)` });
    }
    if (pick.actions.length > rules.maxActions) {
      err({ code: 'too_many_actions', slot, message: `At most ${rules.maxActions} actions per player` });
    }
    const groups = new Set<string>();
    const ids = new Set<string>();
    for (const actionId of pick.actions) {
      if (!rules.actions.has(actionId)) {
        err({ code: 'unknown_action', slot, actionId, message: `Unknown action ${actionId}` });
        continue;
      }
      const a = rules.byPosition[pick.position].get(actionId);
      if (!a) {
        err({
          code: 'action_not_for_position',
          slot,
          actionId,
          message: `${actionId} not available for ${pick.position}`,
        });
        continue;
      }
      if (rules.basicFeedOnly && a.feed !== 'basic') {
        err({
          code: 'advanced_feed_action',
          slot,
          actionId,
          message: `${actionId} needs the advanced data feed`,
        });
      }
      if (ids.has(actionId))
        err({ code: 'duplicate_action', slot, actionId, message: `${actionId} picked twice` });
      ids.add(actionId);
      if (rules.noOverlap && groups.has(a.overlapGroup)) {
        err({
          code: 'overlap_group',
          slot,
          actionId,
          message: `Two actions from the "${a.overlapGroup}" group`,
        });
      }
      groups.add(a.overlapGroup);
      if (a.chaos) chaos += 1;
    }
  }
  if (chaos > rules.maxChaos) {
    err({ code: 'too_many_chaos', message: `At most ${rules.maxChaos} chaos action(s) per squad` });
  }
  if (
    sel.captain !== null &&
    (sel.captain < 0 || sel.captain >= sel.starters.length || !Number.isInteger(sel.captain))
  ) {
    err({ code: 'bad_captain', message: 'Captain must be one of the five starters' });
  }
  if (sel.bold) {
    const pick = sel.bold.slot === SUB_SLOT ? sel.sub : sel.starters[sel.bold.slot];
    if (rules.boldPerGameweek < 1 || !pick || !pick.actions.includes(sel.bold.actionId)) {
      err({
        code: 'bold_not_picked',
        slot: sel.bold.slot,
        actionId: sel.bold.actionId,
        message: 'Bold action must be one of your picked actions',
      });
    }
  }
  return errors;
}
