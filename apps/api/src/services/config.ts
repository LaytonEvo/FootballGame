import { readFileSync } from 'node:fs';
import { and, eq } from 'drizzle-orm';
import type { EconomyConfig, ScoringConfig } from '@ff/shared';
import { parseEconomyConfig, parseScoringConfig } from '@ff/shared';
import type { RuleSet } from '@ff/scoring';
import { compileRules } from '@ff/scoring';
import type { DbOrTx } from '../db/client.js';
import { configVersions } from '../db/schema.js';
import { newId } from '../ids.js';

export const SEASON = process.env.SEASON ?? '2026-27-test';
const CONFIG_DIR = new URL('../../../../config/', import.meta.url);

export function readConfigFile(name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, CONFIG_DIR), 'utf8'));
}

/** Insert a config version (idempotent). Activates it if `activate` or if nothing is active yet. */
export async function upsertConfigVersion(
  db: DbOrTx,
  kind: 'scoring' | 'economy',
  raw: unknown,
  opts: { season?: string; activate?: boolean } = {},
) {
  const season = opts.season ?? SEASON;
  const parsed = kind === 'scoring' ? parseScoringConfig(raw) : parseEconomyConfig(raw);
  const existing = await db
    .select()
    .from(configVersions)
    .where(
      and(
        eq(configVersions.kind, kind),
        eq(configVersions.version, parsed.version),
        eq(configVersions.season, season),
      ),
    );
  const row =
    existing[0] ??
    (
      await db
        .insert(configVersions)
        .values({ id: newId(), kind, version: parsed.version, season, body: raw })
        .returning()
    )[0]!;
  const active = await db
    .select()
    .from(configVersions)
    .where(
      and(eq(configVersions.kind, kind), eq(configVersions.season, season), eq(configVersions.active, true)),
    );
  if (opts.activate || active.length === 0) await activateConfigVersion(db, kind, parsed.version, season);
  return row;
}

export async function activateConfigVersion(
  db: DbOrTx,
  kind: 'scoring' | 'economy',
  version: string,
  season = SEASON,
) {
  const target = await db
    .select()
    .from(configVersions)
    .where(
      and(
        eq(configVersions.kind, kind),
        eq(configVersions.version, version),
        eq(configVersions.season, season),
      ),
    );
  if (!target[0]) throw new Error(`No ${kind} config version ${version} for ${season}`);
  await db
    .update(configVersions)
    .set({ active: false })
    .where(and(eq(configVersions.kind, kind), eq(configVersions.season, season)));
  await db.update(configVersions).set({ active: true }).where(eq(configVersions.id, target[0].id));
  ruleCache.clear();
}

const ruleCache = new Map<string, RuleSet>();

export async function getScoringConfig(
  db: DbOrTx,
  version?: string,
  season = SEASON,
): Promise<ScoringConfig> {
  const cond = version
    ? and(
        eq(configVersions.kind, 'scoring'),
        eq(configVersions.season, season),
        eq(configVersions.version, version),
      )
    : and(
        eq(configVersions.kind, 'scoring'),
        eq(configVersions.season, season),
        eq(configVersions.active, true),
      );
  const [row] = await db.select().from(configVersions).where(cond);
  if (!row) throw new Error(`No ${version ? `scoring v${version}` : 'active scoring'} config for ${season}`);
  return parseScoringConfig(row.body);
}

/** Compiled rules for a version (or the active one). Cached per version. */
export async function getRules(db: DbOrTx, version?: string, season = SEASON): Promise<RuleSet> {
  const key = `${season}:${version ?? 'active'}`;
  const hit = ruleCache.get(key);
  if (hit) return hit;
  const rules = compileRules(await getScoringConfig(db, version, season));
  ruleCache.set(key, rules);
  ruleCache.set(`${season}:${rules.version}`, rules);
  return rules;
}

export async function getEconomy(db: DbOrTx, season = SEASON): Promise<EconomyConfig> {
  const [row] = await db
    .select()
    .from(configVersions)
    .where(
      and(
        eq(configVersions.kind, 'economy'),
        eq(configVersions.season, season),
        eq(configVersions.active, true),
      ),
    );
  if (!row) throw new Error(`No active economy config for ${season}`);
  return parseEconomyConfig(row.body);
}

export async function seedConfigs(db: DbOrTx) {
  await upsertConfigVersion(db, 'scoring', readConfigFile('scoring.v0.2.json'));
  await upsertConfigVersion(db, 'economy', readConfigFile('economy.v0.1.json'));
}
