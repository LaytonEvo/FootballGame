"""Points-table simulation on 2025/26 Premier League player-gameweek data.

Usage: python3 -I sim.py <merged_gw.csv> <outdir>
"""
import sys, json, os
import numpy as np
import pandas as pd

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(2627)

d = pd.read_csv(SRC)
# one row per player per gameweek (double gameweeks combined)
num = ['goals_scored', 'assists', 'clean_sheets', 'saves', 'yellow_cards', 'red_cards', 'own_goals',
       'penalties_missed', 'penalties_saved', 'tackles', 'clearances_blocks_interceptions',
       'defensive_contribution', 'minutes', 'starts', 'total_points']
g = (d.groupby(['element', 'GW'])
       .agg({**{c: 'sum' for c in num}, 'position': 'first', 'name': 'first', 'team': 'first', 'value': 'first'})
       .reset_index().sort_values(['element', 'GW']))

# Pick pool: regular starters known BEFORE the deadline = averaged 60+ mins over previous 4 gameweeks
g['prior_min'] = g.groupby('element').minutes.transform(lambda s: s.shift(1).rolling(4, min_periods=3).mean())
pool = g[g.prior_min >= 60].copy()

# Card tier proxy: FPL price quartile within position (Bronze..Elite)
pool['tier'] = pool.groupby('position').value.transform(
    lambda s: pd.qcut(s.rank(method='first'), 4, labels=['Bronze', 'Silver', 'Gold', 'Elite'])).astype(str)

dc_thr = pool.position.map({'GK': 99, 'DEF': 10, 'MID': 12, 'FWD': 12})
sub_on = (pool.starts == 0) & (pool.minutes > 0)
OUTCOME = {
    'Scores a goal (per goal)':        pool.goals_scored,            # count-based
    'Scores 2+ goals':                 (pool.goals_scored >= 2),
    'Hat-trick':                       (pool.goals_scored >= 3),
    'Assist':                          (pool.assists >= 1),
    'Goal involvement':                (pool.goals_scored + pool.assists >= 1),
    'Clean sheet (60+ mins)':          (pool.clean_sheets >= 1),
    '3+ saves':                        (pool.saves >= 3),
    '5+ saves':                        (pool.saves >= 5),
    'Penalty save':                    (pool.penalties_saved >= 1),
    '3+ tackles':                      (pool.tackles >= 3),
    '5+ clearances/blocks/interceptions': (pool.clearances_blocks_interceptions >= 5),
    'Defensive contribution target':   (pool.defensive_contribution >= dc_thr),
    'Plays full 90':                   (pool.minutes >= 90),
    'Off the bench and scores':        (sub_on & (pool.goals_scored >= 1)),
    'Yellow card':                     (pool.yellow_cards >= 1),
    'Red card':                        (pool.red_cards >= 1),
    'Own goal':                        (pool.own_goals >= 1),
    'Misses a penalty':                (pool.penalties_missed >= 1),
    'Scores and gets booked':          ((pool.goals_scored >= 1) & (pool.yellow_cards >= 1)),
}
CHAOS = {'Yellow card', 'Red card', 'Own goal', 'Misses a penalty', 'Scores and gets booked'}
OVERLAP = [{'Scores a goal (per goal)', 'Scores 2+ goals', 'Hat-trick', 'Goal involvement', 'Off the bench and scores',
            'Scores and gets booked'}, {'Assist', 'Goal involvement'}, {'3+ saves', '5+ saves'}]
POS = ['GK', 'DEF', 'MID', 'FWD']

V01 = {  # action: (GK, DEF, MID, FWD); None = not available
    'Scores a goal (per goal)': (50, 20, 12, 7), 'Scores 2+ goals': (None, 50, 30, 18), 'Hat-trick': (None, None, 60, 40),
    'Assist': (30, 10, 8, 8), 'Goal involvement': (None, 7, 5, 4), 'Clean sheet (60+ mins)': (5, 5, 8, None),
    '3+ saves': (3, None, None, None), '5+ saves': (7, None, None, None), 'Penalty save': (25, None, None, None),
    '3+ tackles': (None, 5, 5, 10), '5+ clearances/blocks/interceptions': (None, 3, 8, None),
    'Defensive contribution target': (None, 4, 6, None), 'Plays full 90': (1, 2, 2, 3),
    'Off the bench and scores': (None, 40, 25, 15), 'Yellow card': (10, 4, 4, 5), 'Red card': (25, 15, 15, 15),
    'Own goal': (20, 15, 15, 20), 'Misses a penalty': (None, 15, 12, 10), 'Scores and gets booked': (None, 30, 20, 15),
}

def table(points):
    rows = []
    for a, vals in points.items():
        o = OUTCOME[a].astype(float)
        for p, v in zip(POS, vals):
            if v is None: continue
            m = pool.position == p
            hit = (o[m] > 0).mean()
            ev = (o[m] * v).mean()
            rows.append(dict(action=a, position=p, points=v, hit_rate=hit, ev=ev, chaos=a in CHAOS))
    return pd.DataFrame(rows)

# ---- v0.2: price each action to a target average per pick, by risk band ----
TARGET = {'safe': 1.6, 'solid': 1.6, 'bold': 1.5, 'long': 1.0, 'chaos': 0.6}
CAP = 60
def band(hit, chaos):
    if chaos: return 'chaos'
    if hit >= 0.40: return 'safe'
    if hit >= 0.20: return 'solid'
    if hit >= 0.08: return 'bold'
    return 'long'
def nice(x):
    return int(max(1, min(CAP, round(x) if x < 10 else 5 * round(x / 5))))
V02 = {}
for a, vals in V01.items():
    o = OUTCOME[a].astype(float)
    new = []
    for p, v in zip(POS, vals):
        if v is None: new.append(None); continue
        m = pool.position == p
        hit = (o[m] > 0).mean(); mean_count = o[m].mean()
        if hit < 0.004:  # too rare to price or offer
            new.append(None); continue
        new.append(nice(TARGET[band(hit, a in CHAOS)] / mean_count))
    V02[a] = tuple(new)

t1, t2 = table(V01), table(V02)
t1['band'] = [band(h, c) for h, c in zip(t1.hit_rate, t1.chaos)]
t2['band'] = [band(h, c) for h, c in zip(t2.hit_rate, t2.chaos)]

# ---- season simulation ----
def best_picks(points_tab, pos, chaos_ok=True):
    """expected-value ranking for a position (what a smart player learns over time)"""
    t = points_tab[points_tab.position == pos]
    if not chaos_ok: t = t[~t.chaos]
    return list(t.sort_values('ev', ascending=False).action)

def score_pick(row, action, pts):
    pos_i = POS.index(row.position)
    v = pts[action][pos_i]
    if v is None: return 0.0
    o = OUTCOME[action].loc[row.Index]
    return float(o) * v

def valid_pair(a, b):
    return a != b and not any(a in s and b in s for s in OVERLAP)

pool_by_gw = {gw: df for gw, df in pool.groupby('GW')}
SHAPE = ['GK', 'DEF', 'MID', 'MID', 'FWD']

def run_season(pts, strategy, tier_filter=None, n=400):
    tab = table(pts)
    totals = []
    for i in range(n):
        season = 0.0
        for gw, df in pool_by_gw.items():
            picks = []
            used = set()
            for pos in SHAPE:
                cand = df[(df.position == pos) & (~df.element.isin(used))]
                if tier_filter: cand = cand[cand.tier == tier_filter] if (cand.tier == tier_filter).any() else cand
                r = cand.sample(1, random_state=int(rng.integers(1e9))).iloc[0]
                used.add(r.element); picks.append(r)
            gw_pts, chaos_used, scored = 0.0, False, []
            for r in picks:
                avail = [a for a in V01 if pts[a][POS.index(r.position)] is not None]
                if strategy == 'smart':
                    order = [a for a in best_picks(tab, r.position) if a in avail]
                elif strategy == 'always_goal':
                    order = ['Scores a goal (per goal)', 'Goal involvement', 'Clean sheet (60+ mins)', '3+ saves'] + avail
                    order = [a for a in order if a in avail]
                elif strategy == 'chaos_chaser':
                    order = sorted(avail, key=lambda a: -pts[a][POS.index(r.position)])
                else:  # random
                    order = list(rng.permutation(avail))
                chosen = []
                for a in order:
                    if a in CHAOS and (chaos_used or strategy == 'smart' and False):
                        continue
                    if all(valid_pair(a, c) for c in chosen):
                        chosen.append(a)
                        if a in CHAOS: chaos_used = True
                    if len(chosen) == 2: break
                s = sum(float(OUTCOME[a].loc[r.name]) * pts[a][POS.index(r.position)] for a in chosen)
                scored.append(s)
            # captain = player whose picks have highest expected value (approx: highest scorer is not known in advance)
            cap_i = int(rng.integers(len(scored))) if strategy == 'random' else 0
            ev_rank = [sum(tab[(tab.position == r.position)].set_index('action').ev.get(a, 0) for a in []) for r in picks]
            # smart captain: forward or highest-tier player
            if strategy != 'random':
                tiers = ['Bronze', 'Silver', 'Gold', 'Elite']
                cap_i = int(np.argmax([tiers.index(r.tier) + (0.5 if r.position == 'FWD' else 0) for r in picks]))
            gw_pts = sum(scored) + scored[cap_i]
            season += gw_pts
        totals.append(season)
    return np.array(totals)

results = {}
for label, pts in [('v0.1', V01), ('v0.2', V02)]:
    res = {}
    for strat in ['smart', 'always_goal', 'chaos_chaser', 'random']:
        res[strat] = run_season(pts, strat, n=150)
    for tier in ['Bronze', 'Elite']:
        res[f'smart_{tier}'] = run_season(pts, 'smart', tier_filter=tier, n=150)
    results[label] = {k: dict(mean=float(v.mean()), p10=float(np.percentile(v, 10)), p50=float(np.percentile(v, 50)),
                              p90=float(np.percentile(v, 90)), top1=float(np.percentile(v, 99))) for k, v in res.items()}

# FPL comparison: how much better is an Elite squad than a Bronze one under FPL's own scoring?
fpl = pool.groupby('tier').total_points.mean().to_dict()

t1.to_csv(f'{OUT}/v01_table.csv', index=False)
t2.to_csv(f'{OUT}/v02_table.csv', index=False)
json.dump(dict(results=results, fpl_tier_avg=fpl, pool_rows=int(len(pool)), all_rows=int(len(g)),
               v02={k: v for k, v in V02.items()}), open(f'{OUT}/summary.json', 'w'), indent=1, default=str)
print('pool', len(pool), 'of', len(g))
print(json.dumps(results, indent=1))
print('FPL avg pts per GW by tier', fpl)
