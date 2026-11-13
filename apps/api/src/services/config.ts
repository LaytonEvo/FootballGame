import { readFileSync } from 'node:fs';
import { and, eq } from 'drizzle-orm';
import type { EconomyConfig, PacksConfig, ScoringConfig } from '@ff/shared';
import { parseEconomyConfig, parsePacksConfig, parseScoringConfig } from '@ff/shared';
import type { RuleSet } from '@ff/scoring';
import { compileRules } from '@ff/scoring';
import type { DbOrTx } from '../db/client.js';
import { configVersions } from '../db/schema.js';
import { newId } from '../ids.js';

export type ConfigKind = 'scoring' | 'economy' | 'packs';
const PARSERS: Record<ConfigKind, (raw: unknown) => { version: string }> = {
  scoring: parseScoringConfig,
  economy: parseEconomyConfig,
  packs: parsePacksConfig,
};

export const SEASON = process.env.SEASON ?? '2026-27-test';
const CONFIG_DIR = new URL('../../../../config/', import.meta.url);

export function readConfigFile(name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, CONFIG_DIR), 'utf8'));
}

/** Insert a config version (idempotent). Activates it if `activate` or if nothing is active yet. */
export async function upsertConfigVersion(
  db: DbOrTx,
  kind: ConfigKind,
  raw: unknown,
  opts: { season?: string; activate?: boolean } = {},
) {
  const season = opts.season ?? SEASON;
  const parsed = PARSERS[kind](raw);
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

export async function activateConfigVersion(db: DbOrTx, kind: ConfigKind, version: string, season = SEASON) {
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

async function activeBody(db: DbOrTx, kind: ConfigKind, season: string) {
  const [row] = await db
    .select()
    .from(configVersions)
    .where(
      and(eq(configVersions.kind, kind), eq(configVersions.season, season), eq(configVersions.active, true)),
    );
  if (!row) throw new Error(`No active ${kind} config for ${season}`);
  return row.body;
}

export async function getEconomy(db: DbOrTx, season = SEASON): Promise<EconomyConfig> {
  return parseEconomyConfig(await activeBody(db, 'economy', season));
}

export async function getPacksConfig(db: DbOrTx, season = SEASON): Promise<PacksConfig> {
  return parsePacksConfig(await activeBody(db, 'packs', season));
}

export async function seedConfigs(db: DbOrTx) {
  await upsertConfigVersion(db, 'scoring', readConfigFile('scoring.v0.2.json'));
  // v0.3 adds the substitute fallbacks. Loaded but not auto-activated: staff switch versions in the console.
  await upsertConfigVersion(db, 'scoring', readConfigFile('scoring.v0.3.json'));
  await upsertConfigVersion(db, 'economy', readConfigFile('economy.v0.1.json'));
  // v0.2 adds earned limited editions and card-for-card trading (activate from the staff console).
  await upsertConfigVersion(db, 'economy', readConfigFile('economy.v0.2.json'));
  await upsertConfigVersion(db, 'packs', readConfigFile('packs.v0.1.json'));
}
