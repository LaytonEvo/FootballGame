import { and, asc, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import type { PlayerMatchStats } from '@ff/shared';
import { TIER_LABEL } from '@ff/shared';
import type { Selection } from '@ff/scoring';
import {
  autoPick,
  availableActions,
  carryOver,
  formHint,
  potentialPoints,
  validateSelection,
} from '@ff/scoring';
import type { AppContext } from '../context.js';
import type { DbOrTx } from '../db/client.js';
import {
  analyticsEvents,
  clubs,
  fixtures,
  gameweeks,
  playerMatchStats,
  players,
  selections,
} from '../db/schema.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { previousLockedSelection } from '../jobs/gameweek.js';
import { track } from './analytics.js';
import { getRules, SEASON } from './config.js';
import { grantPack } from './packs.js';
import type { StoredSelection } from './selection-body.js';
import { currentSquadSelection } from './squad-read.js';
import { setSquad } from './squad.js';

type Gameweek = typeof gameweeks.$inferSelect;

/** The gameweek players should be looking at: the live/provisional one, else the next upcoming. */
export async function currentGameweek(db: DbOrTx, season = SEASON): Promise<Gameweek | null> {
  const rows = await db
    .select()
    .from(gameweeks)
    .where(eq(gameweeks.season, season))
    .orderBy(asc(gameweeks.number));
  return (
    rows.find((g) => ['locked', 'live', 'provisional'].includes(g.status)) ??
    rows.find((g) => g.status === 'upcoming') ??
    rows.at(-1) ??
    null
  );
}

export async function nextUpcomingGameweek(db: DbOrTx, season = SEASON): Promise<Gameweek | null> {
  const [gw] = await db
    .select()
    .from(gameweeks)
    .where(and(eq(gameweeks.season, season), eq(gameweeks.status, 'upcoming')))
    .orderBy(asc(gameweeks.number))
    .limit(1);
  return gw ?? null;
}

async function gameweekById(db: DbOrTx, id: string) {
  const [gw] = await db.select().from(gameweeks).where(eq(gameweeks.id, id));
  if (!gw) throw notFound('Gameweek');
  return gw;
}

/** "v ARS (H)" per club for a gameweek (double gameweeks list both; blanks get none). */
async function fixtureContext(db: DbOrTx, gw: Gameweek) {
  const fx = await db
    .select()
    .from(fixtures)
    .where(eq(fixtures.gameweekId, gw.id))
    .orderBy(asc(fixtures.kickoffAt));
  const codes = new Map(
    (await db.select({ id: clubs.id, code: clubs.code }).from(clubs)).map((c) => [c.id, c.code]),
  );
  const byClub = new Map<
    string,
    { label: string; kickoffAt: Date | null; fixtureId: string; status: string }[]
  >();
  for (const f of fx) {
    const add = (club: string, opp: string, ha: 'H' | 'A') =>
      byClub.set(club, [
        ...(byClub.get(club) ?? []),
        {
          label: `v ${codes.get(opp)} (${ha})`,
          kickoffAt: f.kickoffAt,
          fixtureId: f.id,
          status: f.voided ? 'abandoned' : f.status,
        },
      ]);
    add(f.homeClubId, f.awayClubId, 'H');
    add(f.awayClubId, f.homeClubId, 'A');
  }
  return { byClub, codes };
}

/** Last five finished gameweeks of stats per player, most recent first. */
async function recentStats(db: DbOrTx, gw: Gameweek, playerIds: string[]) {
  if (playerIds.length === 0) return new Map<string, PlayerMatchStats[][]>();
  const prev = await db
    .select({ id: gameweeks.id, number: gameweeks.number })
    .from(gameweeks)
    .where(
      and(
        eq(gameweeks.season, gw.season),
        lt(gameweeks.number, gw.number),
        gte(gameweeks.number, gw.number - 5),
      ),
    )
    .orderBy(desc(gameweeks.number));
  if (prev.length === 0) return new Map();
  const rows = await db
    .select({ s: playerMatchStats, gwId: fixtures.gameweekId })
    .from(playerMatchStats)
    .innerJoin(fixtures, eq(fixtures.id, playerMatchStats.fixtureId))
    .where(
      and(
        inArray(playerMatchStats.playerId, playerIds),
        inArray(
          fixtures.gameweekId,
          prev.map((p) => p.id),
        ),
      ),
    );
  const out = new Map<string, PlayerMatchStats[][]>();
  for (const pid of playerIds) {
    out.set(
      pid,
      prev.map((p) =>
        rows
          .filter((r) => r.s.playerId === pid && r.gwId === p.id)
          .map((r) => ({
            ...(r.s.stats as Omit<PlayerMatchStats, 'playerId' | 'fixtureId'>),
            playerId: pid,
            fixtureId: r.s.fixtureId,
          })),
      ),
    );
  }
  return out;
}

function formText(
  rules: Parameters<typeof formHint>[0],
  actionId: string,
  position: Parameters<typeof formHint>[2],
  history: PlayerMatchStats[][],
) {
  if (!history.length) return null;
  const h = formHint(rules, actionId, position, history);
  return h.of > 0 ? h.text : null;
}

/**
 * Pre-deadline nudge from recent minutes (the commercial feed will add real injury news): flags a player who
 * has no match, or has barely played in the last two gameweeks. `history` is most recent first.
 */
export function availabilityWarning(history: PlayerMatchStats[][], hasFixture: boolean): string | null {
  if (!hasFixture) return 'No match this gameweek';
  const recent = history.slice(0, 2);
  if (recent.length === 0) return null;
  const mins = recent.flat().reduce((t, m) => t + m.minutes, 0);
  const span = recent.length === 1 ? 'last gameweek' : 'last 2 gameweeks';
  if (mins === 0) return `0 mins in ${span}`;
  if (mins < 45 * recent.length) return `Only ${mins}′ in ${span}`;
  return null;
}

export interface SelectionInput {
  /** Actions per squad slot, index 0-4 starters, 5 sub. */
  actions: string[][];
  captain: number | null;
  bold: { slot: number; actionId: string } | null;
}

function applyInput(squad: StoredSelection, input: SelectionInput): StoredSelection {
  return {
    starters: squad.starters.map((p, i) => ({ ...p, actions: input.actions[i] ?? [] })),
    sub: squad.sub ? { ...squad.sub, actions: input.actions[5] ?? [] } : null,
    captain: input.captain,
    bold: input.bold,
  };
}

export const toInput = (s: Selection): SelectionInput => ({
  actions: [...s.starters.map((p) => p.actions), ...(s.sub ? [s.sub.actions] : [])],
  captain: s.captain,
  bold: s.bold,
});

/** Everything the pick screen needs for one gameweek. */
export async function pickScreen(ctx: AppContext, userId: string, gameweekId?: string) {
  const { db } = ctx;
  const gw = gameweekId ? await gameweekById(db, gameweekId) : await nextUpcomingGameweek(db);
  if (!gw) throw notFound('Upcoming gameweek');
  const rules = await getRules(db, gw.scoringVersion ?? undefined, gw.season);
  const [saved] = await db
    .select()
    .from(selections)
    .where(and(eq(selections.userId, userId), eq(selections.gameweekId, gw.id)));
  const locked = gw.status !== 'upcoming' || ctx.clock.now() >= gw.deadlineAt;
  const squad = locked && saved ? (saved.body as StoredSelection) : await currentSquadSelection(db, userId);
  if (!squad) throw badRequest('no_squad', 'Open your starter pack first');
  const previous = await previousLockedSelection(db, userId, gw);
  const current: StoredSelection =
    saved && (saved.confirmedAt || locked)
      ? applyInput(squad, toInput(saved.body as StoredSelection))
      : squad;
  const { byClub, codes } = await fixtureContext(db, gw);
  const picks = [...squad.starters, ...(squad.sub ? [squad.sub] : [])];
  const recent = await recentStats(
    db,
    gw,
    picks.map((p) => p.playerId),
  );
  const info = new Map(
    (
      await db
        .select({ id: players.id, name: players.name, shirtNumber: players.shirtNumber })
        .from(players)
        .where(
          inArray(
            players.id,
            picks.map((p) => p.playerId),
          ),
        )
    ).map((p) => [p.id, p]),
  );

  const slots = picks.map((p, slot) => {
    const fx = (p.clubId && byClub.get(p.clubId)) || [];
    const history = recent.get(p.playerId) ?? [];
    return {
      slot,
      cardId: p.cardId,
      playerId: p.playerId,
      name: info.get(p.playerId)?.name ?? '',
      shirtNumber: info.get(p.playerId)?.shirtNumber ?? null,
      position: p.position,
      rarity: p.rarity,
      clubCode: p.clubId ? (codes.get(p.clubId) ?? null) : null,
      fixtures: fx.map((f) => ({ label: f.label, kickoffAt: f.kickoffAt, status: f.status })),
      fixtureLabel: fx.length ? fx.map((f) => f.label).join(', ') : 'No match',
      warning: availabilityWarning(history, fx.length > 0),
      actions: availableActions(rules, p.position).map((a) => ({
        id: a.id,
        label: a.label,
        tier: a.tier,
        tierLabel: TIER_LABEL[a.tier],
        overlapGroup: a.overlapGroup,
        chaos: a.chaos,
        points: a.points,
        hint: formText(rules, a.id, p.position, history),
      })),
    };
  });
  return {
    gameweek: {
      id: gw.id,
      number: gw.number,
      deadlineAt: gw.deadlineAt,
      status: gw.status,
      scoringVersion: rules.version,
    },
    serverTime: ctx.clock.now(),
    locked,
    confirmedAt: saved?.confirmedAt ?? null,
    carriedOver: saved?.carriedOver ?? false,
    slots,
    selection: toInput(current),
    potentialPoints: potentialPoints(rules, current),
    hasLastWeek: !!previous,
  };
}

/** Suggestion helpers (not saved): Same as last week, Auto-pick. */
export async function suggest(
  ctx: AppContext,
  userId: string,
  kind: 'last_week' | 'auto',
  draft?: SelectionInput,
) {
  const gw = await nextUpcomingGameweek(ctx.db);
  if (!gw) throw notFound('Upcoming gameweek');
  const rules = await getRules(ctx.db);
  const squad = await currentSquadSelection(ctx.db, userId);
  if (!squad) throw badRequest('no_squad', 'Open your starter pack first');
  const base = draft ? applyInput(squad, draft) : squad;
  const sel =
    kind === 'last_week'
      ? carryOver(rules, await previousLockedSelection(ctx.db, userId, gw), squad)
      : autoPick(rules, base);
  return { selection: toInput(sel), potentialPoints: potentialPoints(rules, sel) };
}

/**
 * Confirm actions for the upcoming gameweek. Server clock only: rejected at or after the deadline.
 * Editable (re-confirm) until then. Confirming unlocks the weekly free pack (once per gameweek).
 */
export async function confirmSelection(
  ctx: AppContext,
  userId: string,
  gameweekId: string,
  input: SelectionInput,
) {
  const now = ctx.clock.now();
  return ctx.db.transaction(async (tx) => {
    const gw = await gameweekById(tx, gameweekId);
    if (gw.status !== 'upcoming' || now >= gw.deadlineAt)
      throw conflict('locked', 'Actions are locked for this gameweek');
    const rules = await getRules(tx);
    const squad = await currentSquadSelection(tx, userId);
    if (!squad) throw badRequest('no_squad', 'Open your starter pack first');
    const sel = applyInput(squad, input);
    const errors = validateSelection(rules, sel);
    if (errors.length) throw badRequest('invalid_selection', errors.map((e) => e.message).join('; '), errors);
    const values = { body: sel, confirmedAt: now, carriedOver: false, updatedAt: now };
    await tx
      .insert(selections)
      .values({ userId, gameweekId, ...values })
      .onConflictDoUpdate({ target: [selections.userId, selections.gameweekId], set: values });
    const { pack, created } = await grantPack(
      tx,
      now,
      userId,
      'player',
      'weekly_free',
      `weekly:${userId}:${gameweekId}`,
    );
    const [started] = await tx
      .select()
      .from(analyticsEvents)
      .where(and(eq(analyticsEvents.userId, userId), eq(analyticsEvents.name, 'pick_started')))
      .orderBy(desc(analyticsEvents.at))
      .limit(1);
    await track(tx, now, userId, 'actions_confirmed', {
      gameweek: gw.number,
      pickMs:
        started && (started.props as { gameweekId?: string }).gameweekId === gameweekId
          ? now.getTime() - started.at.getTime()
          : null,
    });
    return {
      confirmedAt: now,
      potentialPoints: potentialPoints(rules, sel),
      weeklyPack: created ? pack.id : null,
    };
  });
}

/**
 * One-tap "Swap with sub" from the pick screen: the sub moves into the starter's slot (same position only)
 * and the starter goes to the bench. A confirmed selection for the upcoming gameweek is remapped so each
 * player keeps their actions; the captaincy stays with the slot. Server-side checks as for any squad change.
 */
export async function swapWithSub(ctx: AppContext, userId: string, slot: number) {
  return ctx.db.transaction(async (tx) => {
    const squad = await currentSquadSelection(tx, userId);
    const starter = squad?.starters[slot];
    if (!squad || !starter) throw badRequest('bad_slot', 'Choose one of your five');
    if (!squad.sub) throw badRequest('no_sub', 'You have no substitute');
    if (squad.sub.position !== starter.position) {
      throw badRequest(
        'wrong_position',
        `Your sub is a ${squad.sub.position}; this slot needs a ${starter.position}. Change it in Squad.`,
      );
    }
    const ids = [...squad.starters.map((p) => p.cardId), squad.sub.cardId];
    [ids[slot], ids[5]] = [ids[5]!, ids[slot]!];
    await setSquad(tx, userId, ids);

    const gw = await nextUpcomingGameweek(tx);
    if (gw && gw.status === 'upcoming' && ctx.clock.now() < gw.deadlineAt) {
      const [saved] = await tx
        .select()
        .from(selections)
        .where(and(eq(selections.userId, userId), eq(selections.gameweekId, gw.id)));
      if (saved) {
        const old = saved.body as StoredSelection;
        const swap = (i: number) => (i === slot ? 5 : i === 5 ? slot : i);
        const after = (await currentSquadSelection(tx, userId))!;
        const input = toInput(old);
        const actions = input.actions.map((_, i) => input.actions[swap(i)] ?? []);
        const body = applyInput(after, {
          actions,
          captain: input.captain,
          bold: input.bold ? { slot: swap(input.bold.slot), actionId: input.bold.actionId } : null,
        });
        await tx
          .update(selections)
          .set({ body, updatedAt: ctx.clock.now() })
          .where(and(eq(selections.userId, userId), eq(selections.gameweekId, gw.id)));
      }
    }
    return { ok: true };
  });
}
