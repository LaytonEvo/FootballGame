import type { Position, Rarity } from '@ff/shared';

export interface SlotPick {
  playerId: string;
  position: Position;
  rarity: Rarity;
  actions: string[];
}

/** Slot indexes 0-4 are the starters in squad shape order (GK, DEF, MID, MID, FWD); 5 is the substitute. */
export const SUB_SLOT = 5;

export interface Selection {
  starters: SlotPick[];
  sub: SlotPick | null;
  /** Index into starters (0-4) or null. */
  captain: number | null;
  bold: { slot: number; actionId: string } | null;
}

export const slotOf = (sel: Selection, slot: number): SlotPick | null =>
  slot === SUB_SLOT ? sel.sub : (sel.starters[slot] ?? null);

export const allSlots = (sel: Selection): { slot: number; pick: SlotPick }[] => [
  ...sel.starters.map((pick, slot) => ({ slot, pick })),
  ...(sel.sub ? [{ slot: SUB_SLOT, pick: sel.sub }] : []),
];
