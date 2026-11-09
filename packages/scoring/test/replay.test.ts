import { describe, expect, it } from 'vitest';
import { loadDataset } from '@ff/fpl-dataset';
import { prepareReplay, replaySeason, runScenario, SCENARIOS } from '../src/replay/index.js';
import { rules } from './helpers.js';

const data = prepareReplay(loadDataset(), rules);

describe('2025/26 season replay', () => {
  it('builds a pick pool for gameweeks 4-38', () => {
    expect(data.gameweeks[0]).toBe(4);
    expect(data.gameweeks.at(-1)).toBe(38);
  });

  it('produces identical totals on repeat runs', () => {
    for (const spec of SCENARIOS) {
      const a = runScenario(rules, data, spec, 3);
      const b = runScenario(rules, data, spec, 3);
      expect(a).toEqual(b);
    }
  });

  it('different seeds give different seasons', () => {
    const spec = SCENARIOS[0]!;
    expect(replaySeason(rules, data, spec, 1).total).not.toBe(replaySeason(rules, data, spec, 2).total);
  });

  it('smart beats random and chaos chasing loses', () => {
    const get = (l: string) =>
      runScenario(
        rules,
        data,
        SCENARIOS.find((s) => s.label.startsWith(l))!,
        20,
      );
    const smart = get('smart (redrawn)');
    expect(smart.mean).toBeGreaterThan(get('random').mean);
    expect(get('chaos chaser').mean).toBeLessThan(smart.mean);
  });
});
