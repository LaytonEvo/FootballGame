import { and, eq, inArray } from 'drizzle-orm';
import type { SquadScore } from '@ff/scoring';
import type { AppContext } from '../context.js';
import { coinLedger, gameweekScores, gameweeks, packs, players, selections, users } from '../db/schema.js';
import { notFound } from '../errors.js';
import { leagueMovesFor, table } from './leagues.js';
import type { StoredSelection } from './selection-body.js';
import { SHORT_LABEL, plateName } from './text.js';

export const GAME_NAME = process.env.GAME_NAME ?? 'Fantasy Five';

export async function recapFor(ctx: AppContext, userId: string, gameweekId: string) {
  const [gw] = await ctx.db.select().from(gameweeks).where(eq(gameweeks.id, gameweekId));
  if (!gw) throw notFound('Gameweek');
  const [row] = await ctx.db
    .select()
    .from(gameweekScores)
    .where(and(eq(gameweekScores.userId, userId), eq(gameweekScores.gameweekId, gameweekId)));
  const [sel] = await ctx.db
    .select()
    .from(selections)
    .where(and(eq(selections.userId, userId), eq(selections.gameweekId, gameweekId)));
  if (!row || !sel) throw notFound('Recap');
  const [user] = await ctx.db.select().from(users).where(eq(users.id, userId));
  const score = row.breakdown as SquadScore;
  const body = sel.body as StoredSelection;
  const picks = [...body.starters, ...(body.sub ? [body.sub] : [])];
  const info = new Map(
    (
      await ctx.db
        .select({ id: players.id, name: players.name, n: players.shirtNumber })
        .from(players)
        .where(
          inArray(
            players.id,
            picks.map((p) => p.playerId),
          ),
        )
    ).map((p) => [p.id, p]),
  );
  const five = score.slots.map((s) => {
    const pick = s.slot === 5 ? body.sub! : body.starters[s.slot]!;
    const counted = s.lines.filter((l) => l.state !== 'void');
    return {
      slot: s.slot,
      name: plateName(info.get(s.playerId)?.name ?? ''),
      position: pick.position,
      rarity: pick.rarity,
      shirtNumber: info.get(s.playerId)?.n ?? null,
      captain: body.captain === s.slot,
      role: s.role,
      points: s.points,
      landed: `${counted.filter((l) => l.state === 'landed').length} of ${counted.length}`,
      lines: s.lines.map((l) => ({
        actionId: l.actionId,
        state: l.state,
        points: l.points,
        explanation: l.explanation,
      })),
    };
  });
  const best = score.slots
    .filter((s) => s.counts)
    .flatMap((s) =>
      s.lines
        .filter((l) => l.state === 'landed')
        .map((l) => ({ slot: s.slot, playerId: s.playerId, line: l })),
    )
    .sort((a, b) => b.line.points - a.line.points)[0];
  const leagues = await leagueMovesFor(ctx, userId, gameweekId);
  const global = await table(ctx.db, { kind: 'season' }, null);
  const me = global.find((r) => r.userId === userId);
  const [coins] = await ctx.db
    .select()
    .from(coinLedger)
    .where(eq(coinLedger.idempotencyKey, `gw:${gameweekId}:${userId}`));
  const unlocked = gw.finalisedAt
    ? await ctx.db
        .select({ id: packs.id, type: packs.type, status: packs.status })
        .from(packs)
        .where(
          and(eq(packs.userId, userId), eq(packs.source, 'milestone'), eq(packs.grantedAt, gw.finalisedAt)),
        )
    : [];
  return {
    gameweek: { id: gw.id, number: gw.number, status: gw.status, finalisedAt: gw.finalisedAt },
    displayName: user?.displayName ?? 'Player',
    inviteCode: user?.inviteCode ?? '',
    points: row.total,
    provisional: row.provisional,
    actionsLanded: row.actionsLanded,
    actionsPicked: row.actionsPicked,
    five,
    best: best
      ? {
          name: plateName(info.get(best.playerId)?.name ?? ''),
          label: SHORT_LABEL[best.line.actionId] ?? best.line.label,
          bold: best.line.bold,
          points: best.line.points,
        }
      : null,
    leagues,
    global: me
      ? {
          rank: me.rank,
          size: global.length,
          topPercent: Math.max(1, Math.ceil((me.rank / global.length) * 100)),
        }
      : null,
    coinsEarned: coins?.amount ?? 0,
    packsUnlocked: unlocked,
  };
}

export type Recap = Awaited<ReturnType<typeof recapFor>>;
