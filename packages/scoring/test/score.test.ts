import { describe, expect, it } from 'vitest';
import { potentialPoints, scoreSquad } from '../src/index.js';
import { baseSelection, match, pick, quietWeek, rules, statsMap } from './helpers.js';

const withStats = (...over: ReturnType<typeof match>[]) => {
  const ids = new Set(over.map((m) => m.playerId));
  return statsMap(...quietWeek().filter((m) => !ids.has(m.playerId)), ...over);
};
const line = (s: ReturnType<typeof scoreSquad>, slot: number, i = 0) =>
  s.slots.find((x) => x.slot === slot)!.lines[i]!;

describe('base points and rarity', () => {
  it('gold rarity is ×1.0 and a per-goal action multiplies by goals', () => {
    const s = scoreSquad(rules, baseSelection(), withStats(match('fwd', { goals: 2 })));
    expect(line(s, 4).points).toBe(10); // 5 per goal × 2
    expect(line(s, 4).explanation).toBe('Scores a goal (per goal) landed: 5 × 2 × 1.0 rarity = 10');
  });

  it('applies rarity multipliers: bronze 1.2, silver 1.1, elite 0.9 and rounds at the end', () => {
    const mk = (rarity: 'bronze' | 'silver' | 'elite') =>
      baseSelection({
        starters: baseSelection().starters.map((p, i) =>
          i === 3 ? { ...p, rarity, actions: ['assist'] } : p,
        ),
      });
    const st = withStats(match('m2', { assists: 1 }));
    expect(line(scoreSquad(rules, mk('bronze'), st), 3).points).toBe(18); // 15 × 1.2
    expect(line(scoreSquad(rules, mk('silver'), st), 3).points).toBe(17); // 16.5 → 17
    expect(line(scoreSquad(rules, mk('elite'), st), 3).points).toBe(14); // 13.5 → 14
  });

  it('points are position-specific (DEF goal 25, MID 10, FWD 5)', () => {
    const sel = baseSelection({
      starters: [
        pick('gk', 'GK', ['saves_3plus']),
        pick('def', 'DEF', ['goal']),
        pick('m1', 'MID', ['goal']),
        pick('m2', 'MID', ['plays_90']),
        pick('fwd', 'FWD', ['goal']),
      ],
    });
    const s = scoreSquad(
      rules,
      sel,
      withStats(match('def', { goals: 1 }), match('m1', { goals: 1 }), match('fwd', { goals: 1 })),
    );
    expect([line(s, 1).points, line(s, 2).points, line(s, 4).points]).toEqual([25, 10, 5]);
  });

  it('missed non-bold action scores 0 and counts as picked', () => {
    const s = scoreSquad(rules, baseSelection(), withStats());
    expect(s.total).toBe(0);
    expect(s.actionsLanded).toBe(0);
    expect(s.actionsPicked).toBe(5);
    expect(line(s, 0).state).toBe('missed');
  });
});

describe('captain', () => {
  it('doubles all of the captain’s action points', () => {
    const sel = baseSelection({
      captain: 4,
      starters: baseSelection().starters.map((p, i) => (i === 4 ? { ...p, actions: ['goal', 'assist'] } : p)),
    });
    const s = scoreSquad(rules, sel, withStats(match('fwd', { goals: 1, assists: 1 })));
    expect(line(s, 4, 0).points).toBe(10);
    expect(line(s, 4, 1).points).toBe(40);
    expect(line(s, 4, 1).explanation).toBe('Assist landed: 20 × 1.0 rarity × 2 captain = 40');
  });

  it('captain does not transfer to the substitute', () => {
    const s = scoreSquad(
      rules,
      baseSelection({ captain: 4 }),
      withStats(match('fwd', { minutes: 0 }), match('sub', { assists: 1 })),
    );
    const sub = s.slots.find((x) => x.slot === 5)!;
    expect(sub.role).toBe('sub_in');
    expect(sub.points).toBe(15);
  });
});

describe('bold action', () => {
  it('doubles if landed, combined with rarity and captain in order', () => {
    const sel = baseSelection({
      captain: 3,
      bold: { slot: 3, actionId: 'goal_involvement' },
      starters: baseSelection().starters.map((p, i) => (i === 3 ? { ...p, rarity: 'silver' } : p)),
    });
    const s = scoreSquad(rules, sel, withStats(match('m2', { assists: 1 })));
    // 8 × 1.1 × 2 × 2 = 35.2 → 35
    expect(line(s, 3).points).toBe(35);
    expect(line(s, 3).explanation).toBe(
      'Goal involvement (goal or assist) landed: 8 × 1.1 rarity × 2 bold × 2 captain = 35',
    );
  });

  it('costs 50% of base, rounded up, if missed (not scaled by rarity or captain)', () => {
    const sel = baseSelection({
      captain: 4,
      bold: { slot: 4, actionId: 'goal' },
      starters: baseSelection().starters.map((p, i) => (i === 4 ? { ...p, rarity: 'bronze' } : p)),
    });
    const s = scoreSquad(rules, sel, withStats());
    expect(line(s, 4).points).toBe(-3); // ceil(5 × 0.5)
    expect(s.total).toBe(-3);
  });

  it('bold on a starter who plays 0 minutes is voided, not penalised', () => {
    const sel = baseSelection({ bold: { slot: 4, actionId: 'goal' }, sub: null });
    const s = scoreSquad(rules, sel, withStats(match('fwd', { minutes: 0 })));
    expect(line(s, 4).state).toBe('void');
    expect(s.total).toBe(0);
  });

  it('bold on the sub only counts if the sub comes in', () => {
    const sel = baseSelection({ bold: { slot: 5, actionId: 'assist' } });
    const benched = scoreSquad(rules, sel, withStats());
    expect(benched.total).toBe(0);
    expect(line(benched, 5).state).toBe('void');
    const used = scoreSquad(rules, sel, withStats(match('gk', { minutes: 0 }), match('sub', { assists: 1 })));
    expect(line(used, 5).points).toBe(30);
  });
});

describe('substitute rule', () => {
  it('sub stays on the bench when all starters play', () => {
    const s = scoreSquad(rules, baseSelection(), withStats(match('sub', { assists: 1 })));
    expect(s.slots[5]!.role).toBe('sub_bench');
    expect(s.total).toBe(0);
    expect(s.actionsPicked).toBe(5);
  });

  it('sub comes in with their own actions when a starter plays 0 minutes', () => {
    const s = scoreSquad(
      rules,
      baseSelection(),
      withStats(match('def', { minutes: 0 }), match('sub', { assists: 1 })),
    );
    expect(s.slots[1]!.role).toBe('out');
    expect(s.slots[5]!.role).toBe('sub_in');
    expect(s.total).toBe(15);
    expect(s.actionsPicked).toBe(5); // def's action void, sub's counted
  });

  it('sub uses its own rarity', () => {
    const sel = baseSelection({ sub: pick('sub', 'MID', ['assist'], 'bronze') });
    const s = scoreSquad(rules, sel, withStats(match('def', { minutes: 0 }), match('sub', { assists: 1 })));
    expect(s.total).toBe(18);
  });

  it('starter and sub both 0 minutes: slot scores 0, no penalty', () => {
    const s = scoreSquad(
      rules,
      baseSelection(),
      withStats(match('def', { minutes: 0 }), match('sub', { minutes: 0 })),
    );
    expect(s.total).toBe(0);
    expect(s.slots[5]!.lines[0]!.state).toBe('missed');
  });

  it('blank gameweek for a starter is treated as 0 minutes', () => {
    const st = withStats(match('sub', { assists: 1 }));
    st.delete('fwd');
    const s = scoreSquad(rules, baseSelection(), st);
    expect(s.slots[4]!.role).toBe('out');
    expect(s.total).toBe(15);
  });

  it('only one substitute comes in even if two starters are out', () => {
    const s = scoreSquad(
      rules,
      baseSelection(),
      withStats(match('def', { minutes: 0 }), match('gk', { minutes: 0 }), match('sub', { assists: 1 })),
    );
    expect(s.total).toBe(15);
    expect(s.slots.filter((x) => x.role === 'out')).toHaveLength(2);
  });
});

describe('clean sheet', () => {
  it('needs 60+ minutes', () => {
    const s59 = scoreSquad(
      rules,
      baseSelection(),
      withStats(match('def', { minutes: 59, cleanSheet: true, goalsConceded: 0 })),
    );
    expect(line(s59, 1).state).toBe('missed');
    const s60 = scoreSquad(
      rules,
      baseSelection(),
      withStats(match('def', { minutes: 60, cleanSheet: true, goalsConceded: 0 })),
    );
    expect(line(s60, 1).points).toBe(8);
  });

  it('is pending while live, missed early once a goal is conceded', () => {
    const live = scoreSquad(
      rules,
      baseSelection(),
      withStats(match('def', { status: 'live', minutes: 70, goalsConceded: 0 })),
    );
    expect(line(live, 1).state).toBe('pending');
    expect(live.provisional).toBe(true);
    const broken = scoreSquad(
      rules,
      baseSelection(),
      withStats(match('def', { status: 'live', minutes: 70, goalsConceded: 1 })),
    );
    expect(line(broken, 1).state).toBe('missed');
  });
});

describe('double gameweeks', () => {
  it('resolve on combined stats across both matches', () => {
    const sel = baseSelection({
      starters: baseSelection().starters.map((p, i) =>
        i === 4 ? { ...p, actions: ['goals_2plus', 'assist'] } : p,
      ),
    });
    const s = scoreSquad(
      rules,
      sel,
      withStats(match('fwd', { goals: 1 }), match('fwd', { goals: 1, assists: 1 })),
    );
    expect(line(s, 4, 0).points).toBe(20);
    expect(line(s, 4, 1).points).toBe(20);
  });

  it('per-goal counts goals across both matches', () => {
    const s = scoreSquad(
      rules,
      baseSelection(),
      withStats(match('fwd', { goals: 2 }), match('fwd', { goals: 1 })),
    );
    expect(line(s, 4).points).toBe(15);
  });

  it('clean sheet lands if either match is a 60+ minute clean sheet', () => {
    const s = scoreSquad(
      rules,
      baseSelection(),
      withStats(match('def', { goalsConceded: 2 }), match('def', { cleanSheet: true, goalsConceded: 0 })),
    );
    expect(line(s, 1).state).toBe('landed');
  });

  it('a postponed second match is ignored, the played one still counts', () => {
    const s = scoreSquad(
      rules,
      baseSelection(),
      withStats(match('fwd', { goals: 1 }), match('fwd', { status: 'postponed', minutes: 0 })),
    );
    expect(line(s, 4).points).toBe(5);
  });
});

describe('postponed and abandoned matches', () => {
  it('voids actions on affected players and the sub comes in', () => {
    const sel = baseSelection({ bold: { slot: 4, actionId: 'goal' } });
    const s = scoreSquad(
      rules,
      sel,
      withStats(match('fwd', { status: 'abandoned', minutes: 30, goals: 1 }), match('sub', { assists: 1 })),
    );
    expect(line(s, 4).state).toBe('void');
    expect(line(s, 4).voidReason).toBe('match_void');
    expect(s.total).toBe(15);
  });
});

describe('live states', () => {
  it('monotonic actions land mid-match; others stay pending', () => {
    const st = withStats(
      match('fwd', { status: 'live', minutes: 30, goals: 1 }),
      match('m1', { status: 'live', minutes: 30 }),
      match('gk', { status: 'scheduled', minutes: 0 }),
    );
    const s = scoreSquad(rules, baseSelection(), st);
    expect(line(s, 4).state).toBe('landed');
    expect(line(s, 2).state).toBe('pending');
    expect(line(s, 0).state).toBe('pending');
    expect(s.slots[0]!.role).toBe('starter');
    expect(s.slots[5]!.role).toBe('sub_pending');
    expect(s.provisional).toBe(true);
  });

  it('sent-off player resolves on what happened before the red card', () => {
    const s = scoreSquad(
      rules,
      baseSelection(),
      withStats(match('fwd', { minutes: 40, goals: 1, redCards: 1 })),
    );
    expect(line(s, 4).points).toBe(5);
  });
});

describe('chaos and other actions', () => {
  it('yellow card and scores-and-booked resolve', () => {
    const sel = baseSelection({
      starters: baseSelection().starters.map((p, i) =>
        i === 2 ? { ...p, actions: ['scores_and_booked'] } : p,
      ),
    });
    const s = scoreSquad(rules, sel, withStats(match('m1', { goals: 1, yellowCards: 1 })));
    expect(line(s, 2).points).toBe(40);
  });

  it('advanced-feed actions void when the stat is not supplied', () => {
    const sel = baseSelection({
      starters: baseSelection().starters.map((p, i) => (i === 2 ? { ...p, actions: ['tackles_3plus'] } : p)),
    });
    expect(line(scoreSquad(rules, sel, withStats()), 2).voidReason).toBe('stat_unavailable');
    expect(line(scoreSquad(rules, sel, withStats(match('m1', { tackles: 3 }))), 2).points).toBe(8);
  });

  it('GK saves thresholds and penalty save', () => {
    const sel = baseSelection({
      starters: baseSelection().starters.map((p, i) =>
        i === 0 ? { ...p, actions: ['saves_5plus', 'penalty_save'] } : p,
      ),
    });
    const s = scoreSquad(rules, sel, withStats(match('gk', { saves: 5, penaltiesSaved: 1 })));
    expect(s.slots[0]!.points).toBe(50);
  });
});

describe('determinism and potential', () => {
  it('same input → same output', () => {
    const st = withStats(match('fwd', { goals: 1 }), match('def', { cleanSheet: true, goalsConceded: 0 }));
    expect(scoreSquad(rules, baseSelection({ captain: 1 }), st)).toEqual(
      scoreSquad(rules, baseSelection({ captain: 1 }), st),
    );
  });

  it('potential points sums landed value of every starter action', () => {
    expect(potentialPoints(rules, baseSelection({ captain: 4 }))).toBe(3 + 8 + 3 + 8 + 10);
  });
});
