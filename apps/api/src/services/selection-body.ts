import type { Position, Rarity } from '@ff/shared';
import type { Selection, SlotPick } from '@ff/scoring';

/** A slot as stored: the engine's SlotPick plus the card and the player's club at lock. */
export interface StoredPick extends SlotPick {
  cardId: string;
  clubId: string | null;
  position: Position;
  rarity: Rarity;
}

export interface StoredSelection extends Selection {
  starters: StoredPick[];
  sub: StoredPick | null;
}
