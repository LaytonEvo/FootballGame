import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { boldPenaltyFraction, parseEconomyConfig, parseScoringConfig } from '../src/index.js';

const root = new URL('../../../config/', import.meta.url);
const scoring = JSON.parse(readFileSync(new URL('scoring.v0.2.json', root), 'utf8'));
const economy = JSON.parse(readFileSync(new URL('economy.v0.1.json', root), 'utf8'));

describe('config files', () => {
  it('scoring config parses', () => {
    const cfg = parseScoringConfig(scoring);
    expect(cfg.version).toBe('0.2');
    expect(boldPenaltyFraction(cfg)).toBe(0.5);
    expect(cfg.actions.length).toBeGreaterThan(10);
  });
  it('economy config parses', () => {
    const cfg = parseEconomyConfig(economy);
    expect(cfg.prices_coins.player_pack).toBe(100);
  });
  it('rejects duplicate action ids', () => {
    const bad = structuredClone(scoring);
    bad.actions.push(bad.actions[0]);
    expect(() => parseScoringConfig(bad)).toThrow(/Duplicate/);
  });
});
