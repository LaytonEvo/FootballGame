import { and, asc, eq } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.js';
import { cards, players, squadSlots } from '../db/schema.js';
import type { StoredPick, StoredSelection } from './selection-body.js';

/** Current squad as an empty selection (no actions), or null if the squad is not complete. */
export async function currentSquadSelection(db: DbOrTx, userId: string): Promise<StoredSelection | null> {
  const rows = await db
    .select({ slot: squadSlots.slot, card: cards, player: players })
    .from(squadSlots)
    .innerJoin(cards, eq(cards.id, squadSlots.cardId))
    .innerJoin(players, eq(players.id, cards.playerId))
    .where(and(eq(squadSlots.userId, userId)))
    .orderBy(asc(squadSlots.slot));
  const toPick = (r: (typeof rows)[number]): StoredPick => ({
    cardId: r.card.id,
    playerId: r.player.id,
    position: r.player.position,
    rarity: r.card.rarity,
    clubId: r.player.clubId,
    actions: [],
  });
  const starters = [0, 1, 2, 3, 4].map((s) => rows.find((r) => r.slot === s));
  if (starters.some((r) => !r)) return null;
  const sub = rows.find((r) => r.slot === 5);
  return {
    starters: starters.map((r) => toPick(r!)),
    sub: sub ? toPick(sub) : null,
    captain: null,
    bold: null,
  };
}
