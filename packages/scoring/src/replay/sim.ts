import type { PlayerMatchStats, Position, Rarity } from '@ff/shared';
import { RARITIES, STARTER_SHAPE } from '@ff/shared';
import type { Dataset } from '@ff/fpl-dataset';
import { basicFeedOnly } from '@ff/fpl-dataset';
import { aggregate } from '../aggregate.js';
import { autoPick } from '../autopick.js';
import type { ActionForPosition, RuleSet } from '../rules.js';
import { availableActions } from '../rules.js';
import { mulberry32, pickOne, seedFromString, shuffle } from '../rng.js';
import type { Selection, SlotPick } from '../selection.js';
import { SUB_SLOT } from '../selection.js';
import type { SquadScore } from '../score.js';
import { scoreSquad } from '../score.js';
import { validateSelection } from '../validate.js';

export type Strategy = 'casual' | 'casual_bold' | 'smart' | 'always_goal' | 'chaos_chaser' | 'random';
export type SquadMode = 'redrawn' | 'persistent';

export interface PoolEntry {
  playerId: string;
  position: Position;
  gameweek: number;
  tier: Rarity;
}

export interface ReplayData {
  gameweeks: number[];
  /** Stats per gameweek per player (all players, double gameweeks as multiple matches). */
  stats: Map<number, Map<string, PlayerMatchStats[]>>;
  /** Pick pool per gameweek: regulars who averaged 60+ minutes over their previous 4 gameweeks (min 3). */
  pool: Map<number, Map<Position, PoolEntry[]>>;
}

/** Build replay inputs from the dataset, mirroring tools/sim/sim.py's pool and tier proxy. */
export function prepareReplay(ds: Dataset, rules: RuleSet): ReplayData {
  const stats = new Map<number, Map<string, PlayerMatchStats[]>>();
  const perPlayer = new Map<string, Map<number, { position: Position; value: number; minutes: number }>>();
  for (const m of ds.playerMatches) {
    const s = rules.basicFeedOnly ? basicFeedOnly(m.stats) : m.stats;
    let gw = stats.get(m.gameweek);
    if (!gw) stats.set(m.gameweek, (gw = new Map()));
    const id = String(m.playerId);
    gw.set(id, [...(gw.get(id) ?? []), s]);
    let p = perPlayer.get(id);
    if (!p) perPlayer.set(id, (p = new Map()));
    const row = p.get(m.gameweek);
    if (row) row.minutes += m.stats.minutes;
    else p.set(m.gameweek, { position: m.position, value: m.value, minutes: m.stats.minutes });
  }
  // Pool rows ordered by (player, gameweek) as in the Python groupby.
  const rows: (PoolEntry & { value: number })[] = [];
  const ids = [...perPlayer.keys()].sort((a, b) => Number(a) - Number(b));
  for (const id of ids) {
    const gws = [...perPlayer.get(id)!.entries()].sort((a, b) => a[0] - b[0]);
    gws.forEach(([gw, r], i) => {
      const prev = gws.slice(Math.max(0, i - 4), i).map(([, x]) => x.minutes);
      if (prev.length < 3) return;
      const avg = prev.reduce((s, x) => s + x, 0) / prev.length;
      if (avg >= 60)
        rows.push({ playerId: id, position: r.position, gameweek: gw, tier: 'bronze', value: r.value });
    });
  }
  // Tier proxy: price quartile within position (rank method "first").
  for (const pos of ['GK', 'DEF', 'MID', 'FWD'] as Position[]) {
    const ofPos = rows.filter((r) => r.position === pos);
    const ranked = ofPos.map((r, i) => ({ r, i })).sort((a, b) => a.r.value - b.r.value || a.i - b.i);
    ranked.forEach(({ r }, k) => {
      r.tier = RARITIES[Math.min(3, Math.floor((k * 4) / ranked.length))]!;
    });
  }
  const pool = new Map<number, Map<Position, PoolEntry[]>>();
  for (const r of rows) {
    let gw = pool.get(r.gameweek);
    if (!gw) pool.set(r.gameweek, (gw = new Map()));
    const list = gw.get(r.position) ?? [];
    list.push({ playerId: r.playerId, position: r.position, gameweek: r.gameweek, tier: r.tier });
    gw.set(r.position, list);
  }
  const gameweeks = [...pool.keys()].sort((a, b) => a - b);
  return { gameweeks, stats, pool };
}

// ---------- strategies ----------

const boldEv = (rules: RuleSet, a: ActionForPosition) =>
  a.hitRate * a.points * (rules.boldMultiplier - 1) -
  (1 - a.hitRate) * Math.ceil(a.points * rules.boldPenaltyFraction);

function choose(rules: RuleSet, order: ActionForPosition[], chaosLeft: { n: number }): string[] {
  const chosen: ActionForPosition[] = [];
  for (const a of order) {
    if (chosen.length >= rules.maxActions) break;
    if (a.chaos && chaosLeft.n <= 0) continue;
    if (chosen.some((c) => c.id === a.id || (rules.noOverlap && c.overlapGroup === a.overlapGroup))) continue;
    chosen.push(a);
    if (a.chaos) chaosLeft.n -= 1;
  }
  return chosen.map((a) => a.id);
}

function bestCaptain(rules: RuleSet, starters: SlotPick[]): number {
  let best = 0;
  let bestV = -Infinity;
  starters.forEach((p, i) => {
    const v =
      p.actions.reduce((s, id) => s + (rules.byPosition[p.position].get(id)?.expected ?? 0), 0) *
      rules.rarityMultiplier[p.rarity];
    if (v > bestV) {
      bestV = v;
      best = i;
    }
  });
  return best;
}

function pickBold(rules: RuleSet, sel: Selection, score: (a: ActionForPosition) => number, minScore: number) {
  let best: Selection['bold'] = null;
  let bestV = minScore;
  sel.starters.forEach((p, slot) => {
    for (const id of p.actions) {
      const a = rules.byPosition[p.position].get(id)!;
      const v = score(a);
      if (v > bestV) {
        bestV = v;
        best = { slot, actionId: id };
      }
    }
  });
  return best;
}

export function applyStrategy(
  rules: RuleSet,
  strategy: Strategy,
  squad: SlotPick[],
  rand: () => number,
): Selection {
  const starters = squad.slice(0, 5).map((p) => ({ ...p, actions: [] as string[] }));
  const sub = squad[5] ? { ...squad[5], actions: [] as string[] } : null;
  const empty: Selection = { starters, sub, captain: null, bold: null };
  const all = () => [...starters, ...(sub ? [sub] : [])];
  if (strategy === 'casual' || strategy === 'casual_bold') {
    const sel = autoPick(rules, empty);
    if (strategy === 'casual_bold') sel.bold = pickBold(rules, sel, (a) => a.hitRate, -1);
    return sel;
  }
  const chaosLeft = { n: rules.maxChaos };
  for (const p of all()) {
    const avail = availableActions(rules, p.position);
    let order: ActionForPosition[];
    switch (strategy) {
      case 'smart':
        order = avail.filter((a) => !a.chaos).sort((x, y) => y.expected - x.expected);
        break;
      case 'always_goal': {
        const pref = ['goal', 'goal_involvement', 'clean_sheet', 'saves_3plus'];
        order = [
          ...pref.map((id) => avail.find((a) => a.id === id)).filter((a): a is ActionForPosition => !!a),
          ...avail,
        ];
        break;
      }
      case 'chaos_chaser':
        order = [...avail].sort((x, y) => Number(y.chaos) - Number(x.chaos) || y.points - x.points);
        break;
      case 'random':
        order = shuffle(rand, avail);
        break;
    }
    p.actions = choose(rules, order, chaosLeft);
  }
  const sel: Selection = { starters, sub, captain: null, bold: null };
  if (strategy === 'random') {
    sel.captain = Math.floor(rand() * 5);
    if (rand() < 0.5) {
      const slot = Math.floor(rand() * 5);
      sel.bold = { slot, actionId: pickOne(rand, starters[slot]!.actions) };
    }
  } else {
    sel.captain = strategy === 'always_goal' ? 4 : bestCaptain(rules, starters);
    if (strategy === 'smart') sel.bold = pickBold(rules, sel, (a) => boldEv(rules, a), 0);
    if (strategy === 'chaos_chaser') sel.bold = pickBold(rules, sel, (a) => a.points, 0);
  }
  return sel;
}

// ---------- squads ----------

function drawSquad(data: ReplayData, gw: number, rand: () => number, tier?: Rarity): SlotPick[] | null {
  const gwPool = data.pool.get(gw);
  if (!gwPool) return null;
  const used = new Set<string>();
  const out: SlotPick[] = [];
  const draw = (pos: Position | null) => {
    let cand = (pos ? (gwPool.get(pos) ?? []) : [...gwPool.values()].flat()).filter(
      (e) => !used.has(e.playerId),
    );
    if (tier && cand.some((e) => e.tier === tier)) cand = cand.filter((e) => e.tier === tier);
    if (cand.length === 0) return false;
    const e = pickOne(rand, cand);
    used.add(e.playerId);
    out.push({ playerId: e.playerId, position: e.position, rarity: e.tier, actions: [] });
    return true;
  };
  for (const pos of STARTER_SHAPE) if (!draw(pos)) return null;
  if (!draw(null)) return null;
  return out;
}

// ---------- season replay ----------

export interface ScenarioSpec {
  label: string;
  strategy: Strategy;
  mode: SquadMode;
  tier?: Rarity;
}

export interface SeasonResult {
  total: number;
  coins: number;
  gameweeks: number;
  landed: number;
  picked: number;
  negativeWeeks: number;
  weekly: number[];
}

/** Replay one simulated season. Deterministic for a given (rules, data, spec, seed). */
export function replaySeason(
  rules: RuleSet,
  data: ReplayData,
  spec: ScenarioSpec,
  seed: number,
): SeasonResult {
  const rand = mulberry32(seed);
  const res: SeasonResult = {
    total: 0,
    coins: 0,
    gameweeks: 0,
    landed: 0,
    picked: 0,
    negativeWeeks: 0,
    weekly: [],
  };
  let squad: SlotPick[] | null = null;
  for (const gw of data.gameweeks) {
    if (spec.mode === 'redrawn' || !squad) squad = drawSquad(data, gw, rand, spec.tier);
    if (!squad) continue;
    const sel = applyStrategy(rules, spec.strategy, squad, rand);
    const errs = validateSelection(rules, sel);
    if (errs.length)
      throw new Error(`${spec.label} produced invalid selection: ${errs.map((e) => e.message).join('; ')}`);
    const s: SquadScore = scoreSquad(rules, sel, data.stats.get(gw) ?? new Map());
    res.total += s.total;
    res.coins += Math.max(0, s.total);
    res.gameweeks += 1;
    res.landed += s.actionsLanded;
    res.picked += s.actionsPicked;
    if (s.total < 0) res.negativeWeeks += 1;
    res.weekly.push(s.total);
  }
  return res;
}

export interface ScenarioSummary {
  label: string;
  strategy: Strategy;
  mode: SquadMode;
  tier?: Rarity;
  seasons: number;
  gameweeks: number;
  mean: number;
  p10: number;
  p50: number;
  p90: number;
  p99: number;
  perGameweek: number;
  coinsPerGameweek: number;
  landedPerGameweek: number;
  hitRate: number;
  negativeWeekShare: number;
  /** Mean cumulative season points after each simulated gameweek. */
  cumulative: number[];
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo]! + (s[hi]! - s[lo]!) * (idx - lo);
};

export function runScenario(
  rules: RuleSet,
  data: ReplayData,
  spec: ScenarioSpec,
  seasons: number,
  baseSeed = 2627,
): ScenarioSummary {
  const results = Array.from({ length: seasons }, (_, i) =>
    replaySeason(rules, data, spec, seedFromString(`${baseSeed}:${spec.label}:${i}`)),
  );
  const totals = results.map((r) => r.total);
  const gws = results[0]?.gameweeks ?? 0;
  const sum = (f: (r: SeasonResult) => number) => results.reduce((s, r) => s + f(r), 0);
  const cumulative = Array.from(
    { length: gws },
    (_, w) => results.reduce((s, r) => s + r.weekly.slice(0, w + 1).reduce((a, b) => a + b, 0), 0) / seasons,
  );
  return {
    label: spec.label,
    strategy: spec.strategy,
    mode: spec.mode,
    ...(spec.tier ? { tier: spec.tier } : {}),
    seasons,
    gameweeks: gws,
    mean: sum((r) => r.total) / seasons,
    p10: pct(totals, 0.1),
    p50: pct(totals, 0.5),
    p90: pct(totals, 0.9),
    p99: pct(totals, 0.99),
    perGameweek: sum((r) => r.total) / sum((r) => r.gameweeks),
    coinsPerGameweek: sum((r) => r.coins) / sum((r) => r.gameweeks),
    landedPerGameweek: sum((r) => r.landed) / sum((r) => r.gameweeks),
    hitRate: sum((r) => r.landed) / sum((r) => r.picked),
    negativeWeekShare: sum((r) => r.negativeWeeks) / sum((r) => r.gameweeks),
    cumulative,
  };
}

export const SCENARIOS: ScenarioSpec[] = [
  { label: 'casual (auto-pick, persistent squad)', strategy: 'casual', mode: 'persistent' },
  { label: 'casual + bold (persistent squad)', strategy: 'casual_bold', mode: 'persistent' },
  { label: 'smart (persistent squad)', strategy: 'smart', mode: 'persistent' },
  { label: 'casual (auto-pick, redrawn)', strategy: 'casual', mode: 'redrawn' },
  { label: 'casual + bold (redrawn)', strategy: 'casual_bold', mode: 'redrawn' },
  { label: 'smart (redrawn)', strategy: 'smart', mode: 'redrawn' },
  { label: 'always goal (redrawn)', strategy: 'always_goal', mode: 'redrawn' },
  { label: 'chaos chaser (redrawn)', strategy: 'chaos_chaser', mode: 'redrawn' },
  { label: 'random (redrawn)', strategy: 'random', mode: 'redrawn' },
  { label: 'smart, all Bronze (redrawn)', strategy: 'smart', mode: 'redrawn', tier: 'bronze' },
  { label: 'smart, all Elite (redrawn)', strategy: 'smart', mode: 'redrawn', tier: 'elite' },
];

export { SUB_SLOT, aggregate };
