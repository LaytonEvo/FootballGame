import { randomInt } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { PacksConfig, Position, Rarity } from '@ff/shared';
import { MAX_PLAYERS_PER_CLUB, POSITIONS, RARITIES, STARTER_SHAPE, rarityForRating } from '@ff/shared';
import { mulberry32, pickOne, randInt } from '@ff/scoring';
import type { DbOrTx } from '../db/client.js';
import {
  cards,
  clubs,
  fixtures,
  gameweeks,
  packs,
  playerMatchStats,
  players,
  squadSlots,
} from '../db/schema.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { newId } from '../ids.js';
import { getPacksConfig, SEASON } from './config.js';
import { notify } from './notifications.js';

export type PackType = (typeof packs.$inferSelect)['type'];
export type PackSource = (typeof packs.$inferSelect)['source'];
export type PackRow = typeof packs.$inferSelect;

export interface PackCardResult {
  cardId: string;
  playerId: string;
  name: string;
  position: Position;
  clubCode: string | null;
  rarity: Rarity;
  rating: number;
  duplicate: boolean;
  level: number;
}

/** Grant a sealed pack. Idempotent on grantKey: granting twice returns the first pack. */
export async function grantPack(
  db: DbOrTx,
  at: Date,
  userId: string,
  type: PackType,
  source: PackSource,
  grantKey: string,
  rarity: Rarity | null = null,
): Promise<{ pack: PackRow; created: boolean }> {
  const inserted = await db
    .insert(packs)
    .values({ id: newId(), userId, type, source, grantKey, rarity, grantedAt: at })
    .onConflictDoNothing({ target: packs.grantKey })
    .returning();
  if (inserted[0]) {
    if (source === 'milestone' || source === 'compensation' || source === 'admin') {
      await notify(db, at, {
        userId,
        kind: 'new_pack',
        title: 'New pack ready',
        body:
          source === 'milestone'
            ? 'You reached a season milestone. Open your pack.'
            : 'A free pack is waiting in your collection.',
        data: { route: `/pack/${inserted[0].id}` },
        dedupeKey: `newpack:${inserted[0].id}`,
      });
    }
    return { pack: inserted[0], created: true };
  }
  const [existing] = await db.select().from(packs).where(eq(packs.grantKey, grantKey));
  return { pack: existing!, created: false };
}

/** Published odds for each pack type (shown on the pack and in the shop). */
export function oddsFor(
  cfg: PacksConfig,
  pack: Pick<PackRow, 'type' | 'rarity'>,
): Partial<Record<Rarity, number>> {
  switch (pack.type) {
    case 'starter':
      return { [cfg.starter.base_tier]: 0.8, [cfg.starter.stronger_tier]: 0.2 };
    case 'swap':
      return { [pack.rarity ?? 'bronze']: 1 };
    case 'player':
      return cfg.odds.player;
    case 'squad':
      return cfg.odds.squad;
    default:
      return cfg.odds[pack.type];
  }
}

function drawRarity(rand: () => number, odds: Partial<Record<Rarity, number>>): Rarity {
  let x = rand();
  for (const r of RARITIES) {
    const p = odds[r] ?? 0;
    if (x < p) return r;
    x -= p;
  }
  return RARITIES.filter((r) => (odds[r] ?? 0) > 0).at(-1)!;
}

interface PoolPlayer {
  id: string;
  name: string;
  position: Position;
  clubId: string;
  clubCode: string;
  rating: number;
  rarity: Rarity;
}

/**
 * Minutes per player over the last `window_gameweeks` played gameweeks, and the threshold scaled to however
 * many have been played so far. Null before any gameweek has been played (pre-season: everyone is eligible).
 */
async function recentMinutes(db: DbOrTx, cfg: PacksConfig) {
  const { min_minutes, window_gameweeks } = cfg.pool;
  const played = await db
    .select({ id: gameweeks.id })
    .from(gameweeks)
    .where(and(eq(gameweeks.season, SEASON), inArray(gameweeks.status, ['provisional', 'finalised'])))
    .orderBy(desc(gameweeks.number))
    .limit(window_gameweeks);
  if (played.length === 0) return null;
  const rows = await db
    .select({
      playerId: playerMatchStats.playerId,
      minutes: sql<number>`sum((${playerMatchStats.stats}->>'minutes')::int)::int`,
    })
    .from(playerMatchStats)
    .innerJoin(fixtures, eq(fixtures.id, playerMatchStats.fixtureId))
    .where(
      inArray(
        fixtures.gameweekId,
        played.map((g) => g.id),
      ),
    )
    .groupBy(playerMatchStats.playerId);
  return {
    minutes: new Map(rows.map((r) => [r.playerId, r.minutes])),
    threshold: Math.ceil((min_minutes * played.length) / window_gameweeks),
  };
}

async function pool(db: DbOrTx, cfg: PacksConfig): Promise<PoolPlayer[]> {
  const rows = await db
    .select({
      id: players.id,
      name: players.name,
      position: players.position,
      clubId: players.clubId,
      rating: players.rating,
      clubCode: clubs.code,
    })
    .from(players)
    .innerJoin(clubs, eq(clubs.id, players.clubId))
    .where(and(eq(players.status, 'active'), eq(clubs.inLeague, true)));
  // Only players getting game time: fringe and academy players who barely play make useless cards.
  const recent = await recentMinutes(db, cfg);
  const playing = recent ? rows.filter((r) => (recent.minutes.get(r.id) ?? 0) >= recent.threshold) : rows;
  // Stable order so a logged seed reproduces the draw.
  return playing
    .map((r) => ({ ...r, clubId: r.clubId!, rarity: rarityForRating(cfg, r.rating) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Choose a player of the wanted rarity; if none qualify, the nearest rarity (lower first). */
function choosePlayer(
  rand: () => number,
  all: PoolPlayer[],
  rarity: Rarity,
  ok: (p: PoolPlayer) => boolean,
): PoolPlayer {
  const idx = RARITIES.indexOf(rarity);
  const order = [...RARITIES].sort(
    (a, b) =>
      Math.abs(RARITIES.indexOf(a) - idx) - Math.abs(RARITIES.indexOf(b) - idx) ||
      RARITIES.indexOf(a) - RARITIES.indexOf(b),
  );
  for (const r of order) {
    const cand = all.filter((p) => p.rarity === r && ok(p));
    if (cand.length) return pickOne(rand, cand);
  }
  throw new Error('Pack pool is empty');
}

/** Plan which players a pack contains. Pure given (seed, pool, config). */
export function planPack(
  cfg: PacksConfig,
  pack: Pick<PackRow, 'type' | 'rarity'>,
  all: PoolPlayer[],
  seed: number,
): { player: PoolPlayer; rarity: Rarity }[] {
  const rand = mulberry32(seed);
  const odds = oddsFor(cfg, pack);
  const shaped = pack.type === 'starter' || pack.type === 'squad';
  const clubCount = new Map<string, number>();
  const used = new Set<string>();
  const okFor = (pos: Position | null) => (p: PoolPlayer) =>
    !used.has(p.id) &&
    (!pos || p.position === pos) &&
    (!shaped || (clubCount.get(p.clubId) ?? 0) < MAX_PLAYERS_PER_CLUB);
  const take = (pos: Position | null, rarity: Rarity) => {
    const player = choosePlayer(rand, all, rarity, okFor(pos));
    used.add(player.id);
    clubCount.set(player.clubId, (clubCount.get(player.clubId) ?? 0) + 1);
    return { player, rarity: player.rarity };
  };
  if (pack.type === 'starter') {
    const stronger = randInt(rand, STARTER_SHAPE.length);
    return STARTER_SHAPE.map((pos, i) =>
      take(pos, i === stronger ? cfg.starter.stronger_tier : cfg.starter.base_tier),
    );
  }
  if (pack.type === 'squad') return STARTER_SHAPE.map((pos) => take(pos, drawRarity(rand, odds)));
  const pos = pickOne(rand, POSITIONS); // any position, uniformly
  return [take(pos, drawRarity(rand, odds))];
}

/**
 * Open a sealed pack on the server. The RNG seed, odds version and result are logged on the pack row.
 * Duplicates (same player and rarity already owned) level the existing card up instead of adding a card.
 * The starter pack is auto-placed in squad slots 0-4.
 */
export async function openPack(
  db: DbOrTx,
  at: Date,
  userId: string,
  packId: string,
  seed = randomInt(0, 2 ** 32),
) {
  return db.transaction(async (tx) => {
    const [pack] = await tx
      .select()
      .from(packs)
      .where(and(eq(packs.id, packId), eq(packs.userId, userId)));
    if (!pack) throw notFound('Pack');
    if (pack.status === 'opened') throw conflict('already_opened', 'This pack is already open');
    const cfg = await getPacksConfig(tx);
    const plan = planPack(cfg, pack, await pool(tx, cfg), seed >>> 0);
    const owned = await tx
      .select()
      .from(cards)
      .where(
        and(
          eq(cards.userId, userId),
          inArray(
            cards.playerId,
            plan.map((p) => p.player.id),
          ),
        ),
      );
    const results: PackCardResult[] = [];
    for (const { player, rarity } of plan) {
      const dup = owned.find((c) => c.playerId === player.id && c.rarity === rarity);
      if (dup) {
        const [up] = await tx
          .update(cards)
          .set({ level: dup.level + 1 })
          .where(eq(cards.id, dup.id))
          .returning();
        results.push({
          cardId: dup.id,
          playerId: player.id,
          name: player.name,
          position: player.position,
          clubCode: player.clubCode,
          rarity,
          rating: player.rating,
          duplicate: true,
          level: up!.level,
        });
        continue;
      }
      const cardId = newId();
      await tx.insert(cards).values({
        id: cardId,
        userId,
        playerId: player.id,
        rarity,
        rating: player.rating,
        clubAtOpeningId: player.clubId,
        packId: pack.id,
      });
      results.push({
        cardId,
        playerId: player.id,
        name: player.name,
        position: player.position,
        clubCode: player.clubCode,
        rarity,
        rating: player.rating,
        duplicate: false,
        level: 1,
      });
    }
    const odds = oddsFor(cfg, pack);
    const [opened] = await tx
      .update(packs)
      .set({
        status: 'opened',
        openedAt: at,
        oddsVersion: cfg.version,
        seed: String(seed >>> 0),
        result: { cards: results, odds },
      })
      .where(and(eq(packs.id, pack.id), eq(packs.status, 'sealed')))
      .returning();
    if (!opened) throw conflict('already_opened', 'This pack is already open');
    if (pack.type === 'starter') {
      const existing = await tx.select().from(squadSlots).where(eq(squadSlots.userId, userId));
      if (existing.length === 0) {
        await tx.insert(squadSlots).values(results.map((r, slot) => ({ userId, slot, cardId: r.cardId })));
      }
    }
    return { pack: opened, cards: results, odds, oddsVersion: cfg.version };
  });
}

export async function listPacks(db: DbOrTx, userId: string) {
  const [rows, cfg] = await Promise.all([
    db.select().from(packs).where(eq(packs.userId, userId)),
    getPacksConfig(db),
  ]);
  return rows.map((p) => ({ ...p, odds: oddsFor(cfg, p), oddsVersion: p.oddsVersion ?? cfg.version }));
}

export const assertPackType = (t: string): PackType => {
  if (!['starter', 'player', 'swap', 'squad', 'silver', 'gold', 'elite'].includes(t))
    throw badRequest('bad_pack', `Unknown pack ${t}`);
  return t as PackType;
};
