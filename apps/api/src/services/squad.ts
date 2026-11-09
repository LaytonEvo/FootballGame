import { and, eq, inArray } from 'drizzle-orm';
import { MAX_PLAYERS_PER_CLUB, STARTER_SHAPE } from '@ff/shared';
import type { DbOrTx } from '../db/client.js';
import { cards, clubs, players, squadSlots } from '../db/schema.js';
import { badRequest } from '../errors.js';
import { getPacksConfig } from './config.js';

export const SUB_SLOT = 5;

export interface SquadCard {
  slot: number;
  cardId: string;
  playerId: string;
  name: string;
  position: 'GK' | 'DEF' | 'MID' | 'FWD';
  clubId: string | null;
  clubCode: string | null;
  rarity: 'bronze' | 'silver' | 'gold' | 'elite';
  rating: number;
  level: number;
  active: boolean;
}

export async function getSquad(db: DbOrTx, userId: string): Promise<SquadCard[]> {
  const rows = await db
    .select({ slot: squadSlots.slot, card: cards, player: players, clubCode: clubs.code })
    .from(squadSlots)
    .innerJoin(cards, eq(cards.id, squadSlots.cardId))
    .innerJoin(players, eq(players.id, cards.playerId))
    .leftJoin(clubs, eq(clubs.id, players.clubId))
    .where(eq(squadSlots.userId, userId));
  return rows
    .map((r) => ({
      slot: r.slot,
      cardId: r.card.id,
      playerId: r.player.id,
      name: r.player.name,
      position: r.player.position,
      clubId: r.player.clubId,
      clubCode: r.clubCode,
      rarity: r.card.rarity,
      rating: r.card.rating,
      level: r.card.level,
      active: r.card.active,
    }))
    .sort((a, b) => a.slot - b.slot);
}

export interface SquadProblem {
  code:
    | 'not_owned'
    | 'inactive'
    | 'wrong_position'
    | 'duplicate_player'
    | 'club_limit'
    | 'rating_cap'
    | 'missing_starter';
  slot?: number;
  message: string;
}

/** Validate a proposed squad (card id per slot 0-4, optional sub at 5). */
export async function checkSquad(
  db: DbOrTx,
  userId: string,
  slots: (string | null)[],
): Promise<SquadProblem[]> {
  const ids = slots.filter((x): x is string => !!x);
  const rows = ids.length
    ? await db
        .select({ card: cards, player: players })
        .from(cards)
        .innerJoin(players, eq(players.id, cards.playerId))
        .where(inArray(cards.id, ids))
    : [];
  const byId = new Map(rows.map((r) => [r.card.id, r]));
  const problems: SquadProblem[] = [];
  const clubCount = new Map<string, number>();
  const seenPlayers = new Set<string>();
  let rating = 0;
  slots.forEach((cardId, slot) => {
    if (!cardId) {
      if (slot < 5)
        problems.push({
          code: 'missing_starter',
          slot,
          message: `Slot ${slot} needs a ${STARTER_SHAPE[slot]}`,
        });
      return;
    }
    const r = byId.get(cardId);
    if (!r || r.card.userId !== userId)
      return void problems.push({ code: 'not_owned', slot, message: 'You do not own this card' });
    if (!r.card.active)
      problems.push({ code: 'inactive', slot, message: `${r.player.name} is inactive (left the league)` });
    if (slot < 5 && r.player.position !== STARTER_SHAPE[slot]) {
      problems.push({
        code: 'wrong_position',
        slot,
        message: `Slot ${slot} must be a ${STARTER_SHAPE[slot]}`,
      });
    }
    if (seenPlayers.has(r.player.id))
      problems.push({ code: 'duplicate_player', slot, message: `${r.player.name} is already in your squad` });
    seenPlayers.add(r.player.id);
    if (r.player.clubId) {
      const n = (clubCount.get(r.player.clubId) ?? 0) + 1;
      clubCount.set(r.player.clubId, n);
      if (n > MAX_PLAYERS_PER_CLUB)
        problems.push({
          code: 'club_limit',
          slot,
          message: `Max ${MAX_PLAYERS_PER_CLUB} players from one club`,
        });
    }
    rating += r.card.rating;
  });
  const cap = (await getPacksConfig(db)).squad_rating_cap;
  if (rating > cap)
    problems.push({ code: 'rating_cap', message: `Squad rating ${rating} is over the cap of ${cap}` });
  return problems;
}

/** Replace the whole squad. Changes only affect the next locked gameweek (locked selections are snapshots). */
export async function setSquad(db: DbOrTx, userId: string, slots: (string | null)[]) {
  if (slots.length < 5 || slots.length > 6)
    throw badRequest('bad_squad', 'Send 5 starters and an optional sub');
  const problems = await checkSquad(db, userId, slots);
  if (problems.length) throw badRequest('invalid_squad', problems.map((p) => p.message).join('; '), problems);
  await db.delete(squadSlots).where(eq(squadSlots.userId, userId));
  const values = slots.flatMap((cardId, slot) => (cardId ? [{ userId, slot, cardId }] : []));
  await db.insert(squadSlots).values(values);
  return getSquad(db, userId);
}

/** Put one card into a slot (from pack reveal: "Put in my five"), keeping the rest. */
export async function placeCard(db: DbOrTx, userId: string, cardId: string, slot: number) {
  const current = await getSquad(db, userId);
  const slots: (string | null)[] = [0, 1, 2, 3, 4, 5].map(
    (s) => current.find((c) => c.slot === s)?.cardId ?? null,
  );
  for (let i = 0; i < slots.length; i++) if (slots[i] === cardId) slots[i] = null; // moving within the squad
  slots[slot] = cardId;
  return setSquad(db, userId, slots[5] ? slots : slots.slice(0, 5));
}

/**
 * Fill empty starter slots from the collection (best active card that keeps the squad valid). Used when a
 * card goes inactive so a player is never left without a lockable squad.
 */
export async function autoFillSquad(db: DbOrTx, userId: string) {
  const current = await getSquad(db, userId);
  const slots: (string | null)[] = [0, 1, 2, 3, 4, 5].map(
    (s) => current.find((c) => c.slot === s)?.cardId ?? null,
  );
  const owned = await db
    .select({ card: cards, player: players })
    .from(cards)
    .innerJoin(players, eq(players.id, cards.playerId))
    .where(and(eq(cards.userId, userId), eq(cards.active, true)));
  let changed = false;
  for (let slot = 0; slot < 5; slot++) {
    if (slots[slot]) continue;
    const cands = owned
      .filter((o) => o.player.position === STARTER_SHAPE[slot] && !slots.includes(o.card.id))
      .sort((a, b) => b.card.rating - a.card.rating);
    for (const c of cands) {
      const trial = [...slots];
      trial[slot] = c.card.id;
      if (
        (
          await checkSquad(
            db,
            userId,
            trial.map((x, i) => (i < 5 && !x ? null : x)),
          )
        ).every((p) => p.code === 'missing_starter')
      ) {
        slots[slot] = c.card.id;
        changed = true;
        break;
      }
    }
  }
  if (!changed) return current;
  await db.delete(squadSlots).where(eq(squadSlots.userId, userId));
  await db
    .insert(squadSlots)
    .values(slots.flatMap((cardId, slot) => (cardId ? [{ userId, slot, cardId }] : [])));
  return getSquad(db, userId);
}
