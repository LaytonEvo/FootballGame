import { describe, expect, it } from 'vitest';
import { loadDataset, parseCsv } from '../src/index.js';

describe('csv', () => {
  it('parses quotes and CRLF', () => {
    expect(parseCsv('a,b\r\n"x,1","say ""hi"""\r\n')).toEqual([{ a: 'x,1', b: 'say "hi"' }]);
  });
});

describe('2025/26 snapshot', () => {
  const ds = loadDataset();
  it('has 20 teams, 380 fixtures, 38 gameweeks', () => {
    expect(ds.teams).toHaveLength(20);
    expect(ds.fixtures).toHaveLength(380);
    expect(new Set(ds.playerMatches.map((m) => m.gameweek)).size).toBe(38);
  });
  it('contains blank and double gameweeks', () => {
    const perGw = new Map<number, number>();
    for (const f of ds.fixtures) perGw.set(f.gameweek!, (perGw.get(f.gameweek!) ?? 0) + 1);
    expect(Math.min(...perGw.values())).toBeLessThan(10);
    expect(Math.max(...perGw.values())).toBeGreaterThan(10);
  });
});
