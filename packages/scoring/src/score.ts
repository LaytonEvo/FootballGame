import type { PlayerMatchStats } from '@ff/shared';
import type { GameweekStats } from './aggregate.js';
import { aggregate } from './aggregate.js';
import { RESOLVERS } from './resolvers.js';
import type { RuleSet } from './rules.js';
import type { Selection, SlotPick } from './selection.js';
import { SUB_SLOT } from './selection.js';

export type ActionState = 'pending' | 'landed' | 'missed' | 'void';
export type SlotRole = 'starter' | 'out' | 'sub_in' | 'sub_bench' | 'sub_pending';

export interface ScoreLine {
  actionId: string;
  label: string;
  state: ActionState;
  base: number;
  count: number;
  rarityMultiplier: number;
  bold: boolean;
  captain: boolean;
  /** Points this line contributes now (0 while pending). */
  points: number;
  /** Points if it lands (for pending lines and the potential-points footer). */
  potential: number;
  explanation: string;
  voidReason?: 'no_minutes' | 'match_void' | 'stat_unavailable' | 'sub_not_used';
}

export interface SlotScore {
  slot: number;
  playerId: string;
  role: SlotRole;
  counts: boolean;
  points: number;
  lines: ScoreLine[];
}

export interface SquadScore {
  rulesVersion: string;
  total: number;
  actionsLanded: number;
  /** Actions that counted (not void) — used for the "fewest actions picked" tiebreak. */
  actionsPicked: number;
  provisional: boolean;
  slots: SlotScore[];
}

export type StatsByPlayer = ReadonlyMap<string, readonly PlayerMatchStats[]>;

const fmt = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
/** Round half away from zero (Math.round rounds -2.5 to -2). */
const roundHalfUp = (n: number) => Math.sign(n) * Math.round(Math.abs(n));

/** A starter is "out" when they can no longer play this gameweek and played 0 minutes. */
const isOut = (g: GameweekStats) => g.finished && g.minutes === 0;

function scoreSlot(
  rules: RuleSet,
  slot: number,
  pick: SlotPick,
  g: GameweekStats,
  opts: { captain: boolean; boldActionId: string | null; role: SlotRole },
): SlotScore {
  const counts = opts.role === 'starter' || opts.role === 'sub_in';
  const rarity = rules.rarityMultiplier[pick.rarity];
  const lines: ScoreLine[] = pick.actions.map((actionId) => {
    const a = rules.byPosition[pick.position].get(actionId);
    if (!a) throw new Error(`Action ${actionId} not available for ${pick.position}`);
    const resolver = RESOLVERS[actionId]!;
    const isBold = opts.boldActionId === actionId;
    const boldMult = isBold ? rules.boldMultiplier : 1;
    const capMult = opts.captain ? rules.captainMultiplier : 1;
    const line: ScoreLine = {
      actionId,
      label: a.label,
      state: 'pending',
      base: a.points,
      count: 0,
      rarityMultiplier: rarity,
      bold: isBold,
      captain: opts.captain,
      points: 0,
      potential: roundHalfUp(a.points * rarity * boldMult * capMult),
      explanation: '',
    };
    const voidLine = (reason: NonNullable<ScoreLine['voidReason']>, why: string): ScoreLine => ({
      ...line,
      state: 'void',
      voidReason: reason,
      explanation: `${a.label}: void (${why})`,
    });

    if (opts.role === 'out')
      return voidLine(
        g.voided ? 'match_void' : 'no_minutes',
        g.voided ? 'match postponed or abandoned' : 'did not play',
      );
    if (opts.role === 'sub_bench') return voidLine('sub_not_used', 'substitute not needed');
    if (g.voided) return voidLine('match_void', 'match postponed or abandoned');

    const count = resolver.count(g, pick.position);
    if (count === null) return voidLine('stat_unavailable', 'stat not in data feed');

    let state: ActionState;
    if (count > 0 && (resolver.monotonic || g.finished)) state = 'landed';
    else if (g.finished || resolver.deadEarly?.(g)) state = 'missed';
    else state = 'pending';

    line.state = state;
    if (state === 'landed') {
      line.count = count;
      const raw = a.points * count * rarity * boldMult * capMult;
      line.points = roundHalfUp(raw);
      const parts = [`${a.points}`];
      if (count > 1) parts.push(`${count}`);
      parts.push(`${fmt(rarity)} rarity`);
      if (isBold) parts.push(`${rules.boldMultiplier} bold`);
      if (opts.captain) parts.push(`${rules.captainMultiplier} captain`);
      line.explanation = `${a.label} landed: ${parts.join(' × ')} = ${line.points}`;
    } else if (state === 'missed') {
      line.points = isBold ? -Math.ceil(a.points * rules.boldPenaltyFraction) : 0;
      line.explanation = isBold
        ? `${a.label} missed (bold): −${Math.round(rules.boldPenaltyFraction * 100)}% of ${a.points} = ${line.points}`
        : `${a.label} missed: 0`;
    } else {
      line.explanation = `${a.label}: pending (+${line.potential} if it lands)`;
    }
    if (!counts) line.points = 0;
    return line;
  });
  return {
    slot,
    playerId: pick.playerId,
    role: opts.role,
    counts,
    points: counts ? lines.reduce((s, l) => s + l.points, 0) : 0,
    lines,
  };
}

/**
 * Score one squad for one gameweek. Pure and deterministic: same rules + selection + stats → same result.
 *
 * Rules (config/scoring.v0.2.json): base × rarity × bold (if landed) × captain, rounded per line.
 * Missed bold costs ceil(base × penalty fraction), not multiplied by rarity or captain.
 * The substitute comes in when any starter is out (0 minutes, blank, or match void). Captaincy does not
 * transfer to the sub; the sub scores its own pre-set actions at its own rarity. A bold action on an
 * out starter is voided.
 */
export function scoreSquad(rules: RuleSet, sel: Selection, stats: StatsByPlayer): SquadScore {
  const agg = (id: string) => aggregate(stats.get(id) ?? [], rules.cleanSheetMinMinutes);
  const starterStats = sel.starters.map((p) => agg(p.playerId));
  const anyOut = starterStats.some(isOut);
  const allDecided = starterStats.every((g) => g.finished);

  const slots: SlotScore[] = sel.starters.map((pick, i) =>
    scoreSlot(rules, i, pick, starterStats[i]!, {
      captain: sel.captain === i,
      boldActionId: sel.bold?.slot === i ? sel.bold.actionId : null,
      role: isOut(starterStats[i]!) ? 'out' : 'starter',
    }),
  );
  if (sel.sub) {
    const role: SlotRole = anyOut ? 'sub_in' : allDecided ? 'sub_bench' : 'sub_pending';
    slots.push(
      scoreSlot(rules, SUB_SLOT, sel.sub, agg(sel.sub.playerId), {
        captain: false,
        boldActionId: sel.bold?.slot === SUB_SLOT ? sel.bold.actionId : null,
        role,
      }),
    );
  }
  const counted = slots.filter((s) => s.counts).flatMap((s) => s.lines);
  return {
    rulesVersion: rules.version,
    total: slots.reduce((s, x) => s + x.points, 0),
    actionsLanded: counted.filter((l) => l.state === 'landed').length,
    actionsPicked: counted.filter((l) => l.state !== 'void').length,
    provisional: slots.some((s) => s.lines.some((l) => l.state === 'pending') || s.role === 'sub_pending'),
    slots,
  };
}

/** Sum of potential points if every counted action lands (the footer on the pick screen). */
export function potentialPoints(rules: RuleSet, sel: Selection): number {
  let total = 0;
  sel.starters.forEach((p, i) => {
    for (const id of p.actions) {
      const a = rules.byPosition[p.position].get(id);
      if (!a) continue;
      const bold = sel.bold?.slot === i && sel.bold.actionId === id ? rules.boldMultiplier : 1;
      const cap = sel.captain === i ? rules.captainMultiplier : 1;
      total += roundHalfUp(a.points * rules.rarityMultiplier[p.rarity] * bold * cap);
    }
  });
  return total;
}
