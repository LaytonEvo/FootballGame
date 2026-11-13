import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, asc, desc, eq, ilike, or } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import {
  adminAudit,
  cards,
  clubs,
  coinLedger,
  configVersions,
  fixtures,
  gameweekScores,
  gameweeks,
  leagueMembers,
  packs,
  playerMoves,
  players,
  selections,
  sessions,
  trades,
  users,
} from '../db/schema.js';
import { conflict, HttpError, notFound } from '../errors.js';
import { newId, sha256 } from '../ids.js';
import { coinBalance, ledger } from '../services/coins.js';
import { activateConfigVersion, upsertConfigVersion } from '../services/config.js';
import { queueCardChanges } from '../services/live-notify.js';
import { processDueMoves, promoteClub, recordMove, relegateClub } from '../services/moves.js';
import { hashPhone, normalisePhone } from '../services/phone.js';
import { scoreGameweek } from '../services/scoring.js';
import { rerateAllPlayers } from '../services/ingest.js';

/** STAFF_TOKENS="alice:longrandomtoken,bob:othertoken". Every admin call is audited with the staff name. */
function staffFor(req: FastifyRequest): string {
  const h = req.headers.authorization;
  const token = h?.startsWith('Bearer ') ? h.slice(7) : '';
  for (const pair of (process.env.STAFF_TOKENS ?? '').split(',').filter(Boolean)) {
    const [name, t] = pair.split(':');
    if (!name || !t || t.length < 16) continue;
    const a = Buffer.from(sha256(t));
    const b = Buffer.from(sha256(token));
    if (timingSafeEqual(a, b)) return name;
  }
  throw new HttpError(401, 'staff_only', 'Staff sign-in required');
}

export function adminRoutes(app: FastifyInstance, ctx: AppContext) {
  const audit = async (staff: string, action: string, payload: unknown) =>
    ctx.db.insert(adminAudit).values({ staff, action, payload: payload as object, at: ctx.clock.now() });

  const guard = async (req: FastifyRequest) => staffFor(req);

  // ---------- gameweeks and fixtures ----------
  app.get('/admin/gameweeks', async (req) => {
    await guard(req);
    return ctx.db.select().from(gameweeks).orderBy(asc(gameweeks.number));
  });
  app.get('/admin/gameweeks/:id/fixtures', async (req) => {
    await guard(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const rows = await ctx.db
      .select()
      .from(fixtures)
      .where(eq(fixtures.gameweekId, id))
      .orderBy(asc(fixtures.kickoffAt));
    const codes = new Map((await ctx.db.select().from(clubs)).map((c) => [c.id, c.code]));
    return rows.map((f) => ({ ...f, home: codes.get(f.homeClubId), away: codes.get(f.awayClubId) }));
  });

  const assertNotFinalised = async (gameweekId: string | null) => {
    if (!gameweekId) return null;
    const [gw] = await ctx.db.select().from(gameweeks).where(eq(gameweeks.id, gameweekId));
    if (gw?.status === 'finalised')
      throw conflict('finalised', 'This gameweek is finalised; scores can no longer change');
    return gw ?? null;
  };
  const rescoreIfStarted = async (gw: typeof gameweeks.$inferSelect | null) => {
    if (gw && gw.status !== 'upcoming')
      return (await scoreGameweek(ctx, gw.id, { provisional: true })).length;
    return 0;
  };

  /** Void (or un-void) a match: every action on its players is voided and the sub rule applies. */
  app.post('/admin/fixtures/:id/void', async (req) => {
    const staff = await guard(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { voided, reason } = z
      .object({ voided: z.boolean(), reason: z.string().min(3).max(200) })
      .parse(req.body);
    const [f] = await ctx.db.select().from(fixtures).where(eq(fixtures.id, id));
    if (!f) throw notFound('Fixture');
    const gw = await assertNotFinalised(f.gameweekId);
    await ctx.db.update(fixtures).set({ voided }).where(eq(fixtures.id, id));
    await audit(staff, 'fixture.void', { fixtureId: id, voided, reason });
    return { ok: true, rescored: await rescoreIfStarted(gw) };
  });
  app.post('/admin/fixtures/:id/status', async (req) => {
    const staff = await guard(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { status, reason } = z
      .object({
        status: z.enum(['scheduled', 'live', 'finished', 'postponed', 'abandoned']),
        reason: z.string().min(3).max(200),
      })
      .parse(req.body);
    const [f] = await ctx.db.select().from(fixtures).where(eq(fixtures.id, id));
    if (!f) throw notFound('Fixture');
    const gw = await assertNotFinalised(f.gameweekId);
    await ctx.db.update(fixtures).set({ status }).where(eq(fixtures.id, id));
    await audit(staff, 'fixture.status', { fixtureId: id, status, reason });
    return { ok: true, rescored: await rescoreIfStarted(gw) };
  });
  app.post('/admin/gameweeks/:id/rescore', async (req) => {
    const staff = await guard(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const gw = await assertNotFinalised(id);
    if (!gw || gw.status === 'upcoming') throw conflict('not_started', 'Nothing to score yet');
    const n = (await scoreGameweek(ctx, id, { provisional: true })).length;
    await audit(staff, 'gameweek.rescore', { gameweekId: id, squads: n });
    return { rescored: n };
  });

  // ---------- players, clubs, moves ----------
  app.get('/admin/players', async (req) => {
    await guard(req);
    const { q } = z.object({ q: z.string().min(2) }).parse(req.query);
    return ctx.db
      .select({ player: players, clubCode: clubs.code })
      .from(players)
      .leftJoin(clubs, eq(clubs.id, players.clubId))
      .where(ilike(players.name, `%${q}%`))
      .limit(50);
  });
  app.get('/admin/clubs', async (req) => {
    await guard(req);
    return ctx.db.select().from(clubs).orderBy(asc(clubs.name));
  });
  /** Player rating drives future cards; pass applyToCards to re-rate existing cards too. */
  app.put('/admin/players/:id/rating', async (req) => {
    const staff = await guard(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { rating, applyToCards } = z
      .object({ rating: z.number().int().min(40).max(99), applyToCards: z.boolean().default(false) })
      .parse(req.body);
    const [before] = await ctx.db.select().from(players).where(eq(players.id, id));
    if (!before) throw notFound('Player');
    await ctx.db.update(players).set({ rating }).where(eq(players.id, id));
    const updated = applyToCards
      ? (await ctx.db.update(cards).set({ rating }).where(eq(cards.playerId, id)).returning()).length
      : 0;
    await audit(staff, 'player.rating', {
      playerId: id,
      from: before.rating,
      to: rating,
      cardsUpdated: updated,
    });
    return { ok: true, cardsUpdated: updated };
  });
  /** Re-rate every player within their position (overwrites manual rating edits). */
  app.post('/admin/players/rerate', async (req) => {
    const staff = await guard(req);
    const { cards: alsoCards } = z.object({ cards: z.boolean().default(false) }).parse(req.body ?? {});
    const res = await rerateAllPlayers(ctx, { cards: alsoCards });
    await audit(staff, 'player.rerate', { ...res, cards: alsoCards });
    return res;
  });
  app.put('/admin/cards/:id/rating', async (req) => {
    const staff = await guard(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { rating } = z.object({ rating: z.number().int().min(40).max(99) }).parse(req.body);
    const [c] = await ctx.db.update(cards).set({ rating }).where(eq(cards.id, id)).returning();
    if (!c) throw notFound('Card');
    await audit(staff, 'card.rating', { cardId: id, to: rating });
    return c;
  });
  /** Record a transfer / leaving the league / retirement / return. Applied at the next deadline after registration. */
  app.post('/admin/moves', async (req) => {
    const staff = await guard(req);
    const body = z
      .object({
        playerId: z.string(),
        kind: z.enum(['transfer', 'left_league', 'retired', 'returned']),
        toClubId: z.string().nullable().default(null),
        registeredAt: z.coerce.date().optional(),
      })
      .parse(req.body);
    if ((body.kind === 'transfer' || body.kind === 'returned') && !body.toClubId)
      throw conflict('club_required', 'Choose the new club');
    const move = await recordMove(ctx.db, {
      ref: `admin:${newId()}`,
      playerId: body.playerId,
      kind: body.kind,
      toClubId: body.toClubId,
      registeredAt: body.registeredAt ?? ctx.clock.now(),
    });
    await audit(staff, 'move.record', { ...body, moveId: move?.id });
    return move;
  });
  app.get('/admin/moves', async (req) => {
    await guard(req);
    return ctx.db.select().from(playerMoves).orderBy(desc(playerMoves.registeredAt)).limit(200);
  });
  /** Apply every due move now (the worker also does this each minute). */
  app.post('/admin/moves/process', async (req) => {
    const staff = await guard(req);
    const changes = await processDueMoves(ctx);
    await queueCardChanges(ctx, changes);
    await audit(staff, 'move.process', { changes: changes.length });
    return { changes: changes.length };
  });
  app.post('/admin/clubs/:id/relegate', async (req) => {
    const staff = await guard(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const changes = await relegateClub(ctx, id);
    await queueCardChanges(ctx, changes);
    await audit(staff, 'club.relegate', { clubId: id, cards: changes.length });
    return { cards: changes.length };
  });
  app.post('/admin/clubs/:id/promote', async (req) => {
    const staff = await guard(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await promoteClub(ctx, id);
    await audit(staff, 'club.promote', { clubId: id });
    return { ok: true };
  });

  // ---------- config versions ----------
  app.get('/admin/config', async (req) => {
    await guard(req);
    return ctx.db
      .select({
        id: configVersions.id,
        kind: configVersions.kind,
        version: configVersions.version,
        season: configVersions.season,
        active: configVersions.active,
        createdAt: configVersions.createdAt,
      })
      .from(configVersions)
      .orderBy(asc(configVersions.kind), desc(configVersions.createdAt));
  });
  app.get('/admin/config/:id', async (req) => {
    await guard(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const [row] = await ctx.db.select().from(configVersions).where(eq(configVersions.id, id));
    if (!row) throw notFound('Config version');
    return row;
  });
  /** Upload a new version (validated by the same schema as the files). Not active until activated. */
  app.post('/admin/config', async (req) => {
    const staff = await guard(req);
    const { kind, body } = z
      .object({ kind: z.enum(['scoring', 'economy', 'packs']), body: z.record(z.string(), z.unknown()) })
      .parse(req.body);
    let row;
    try {
      row = await upsertConfigVersion(ctx.db, kind, body, { activate: false });
    } catch (e) {
      throw new HttpError(400, 'invalid_config', (e as Error).message);
    }
    await audit(staff, 'config.upload', { kind, version: row.version });
    return { id: row.id, version: row.version };
  });
  /** Switch the active version. Gameweeks already locked keep the scoring version they locked with. */
  app.post('/admin/config/activate', async (req) => {
    const staff = await guard(req);
    const { kind, version } = z
      .object({ kind: z.enum(['scoring', 'economy', 'packs']), version: z.string() })
      .parse(req.body);
    await activateConfigVersion(ctx.db, kind, version);
    await audit(staff, 'config.activate', { kind, version });
    return { ok: true };
  });

  // ---------- pack logs ----------
  app.get('/admin/packs', async (req) => {
    await guard(req);
    const { userId, limit } = z
      .object({ userId: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) })
      .parse(req.query);
    const where = userId
      ? and(eq(packs.userId, userId), eq(packs.status, 'opened'))
      : eq(packs.status, 'opened');
    return ctx.db.select().from(packs).where(where).orderBy(desc(packs.openedAt)).limit(limit);
  });

  // ---------- users ----------
  app.get('/admin/users', async (req) => {
    await guard(req);
    const { q } = z.object({ q: z.string().min(2) }).parse(req.query);
    let phoneHash: string | null;
    try {
      phoneHash = hashPhone(normalisePhone(q));
    } catch {
      phoneHash = null;
    }
    const conds = [
      ilike(users.displayName, `%${q}%`),
      eq(users.inviteCode, q.toUpperCase()),
      eq(users.id, q),
    ];
    if (phoneHash) conds.push(eq(users.phoneHash, phoneHash));
    return ctx.db
      .select({
        id: users.id,
        displayName: users.displayName,
        inviteCode: users.inviteCode,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(or(...conds))
      .limit(50);
  });
  /** Everything support needs: profile, balance + ledger, cards, packs, selections and scoring breakdowns. */
  app.get('/admin/users/:id', async (req) => {
    await guard(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const [u] = await ctx.db.select().from(users).where(eq(users.id, id));
    if (!u) throw notFound('User');
    const [ledgerRows, balance, cardRows, packRows, sels, tradeRows, scores] = await Promise.all([
      ctx.db.select().from(coinLedger).where(eq(coinLedger.userId, id)).orderBy(desc(coinLedger.id)),
      coinBalance(ctx.db, id),
      ctx.db
        .select({ card: cards, name: players.name, position: players.position })
        .from(cards)
        .innerJoin(players, eq(players.id, cards.playerId))
        .where(eq(cards.userId, id)),
      ctx.db.select().from(packs).where(eq(packs.userId, id)).orderBy(desc(packs.grantedAt)),
      ctx.db.select().from(selections).where(eq(selections.userId, id)),
      ctx.db
        .select()
        .from(trades)
        .where(or(eq(trades.fromUserId, id), eq(trades.toUserId, id)))
        .orderBy(desc(trades.createdAt)),
      ctx.db
        .select({ s: gameweekScores, number: gameweeks.number })
        .from(gameweekScores)
        .innerJoin(gameweeks, eq(gameweeks.id, gameweekScores.gameweekId))
        .where(eq(gameweekScores.userId, id))
        .orderBy(desc(gameweeks.number)),
    ]);
    const { phoneHash: _p, pushToken, ...profile } = u;
    return {
      profile: { ...profile, hasPushToken: !!pushToken },
      balance,
      ledger: ledgerRows,
      ledgerReconciles: ledgerRows.reduce((s, r) => s + r.amount, 0) === balance,
      cards: cardRows,
      packs: packRows,
      selections: sels,
      trades: tradeRows,
      scores: scores.map((r) => ({ gameweek: r.number, ...r.s })),
    };
  });
  app.post('/admin/users/:id/coins', async (req) => {
    const staff = await guard(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { amount, reason } = z
      .object({
        amount: z
          .number()
          .int()
          .refine((n) => n !== 0),
        reason: z.string().min(3).max(200),
      })
      .parse(req.body);
    const key = `admin:${newId()}`;
    await ledger(ctx.db, ctx.clock.now(), id, amount, 'admin_adjustment', key, reason);
    await audit(staff, 'user.coins', { userId: id, amount, reason, key });
    return { balance: await coinBalance(ctx.db, id) };
  });
  /** UK GDPR erasure: anonymise the account, end sessions, leave leagues. Scores stay as anonymous rows. */
  app.post('/admin/users/:id/delete', async (req) => {
    const staff = await guard(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await ctx.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          displayName: 'Deleted player',
          phoneHash: `deleted:${newId()}`,
          pushToken: null,
          favouriteClubId: null,
          notificationPrefs: {},
        })
        .where(eq(users.id, id));
      await tx.delete(sessions).where(eq(sessions.userId, id));
      await tx.delete(leagueMembers).where(eq(leagueMembers.userId, id));
    });
    await audit(staff, 'user.delete', { userId: id });
    return { ok: true };
  });

  app.get('/admin/audit', async (req) => {
    await guard(req);
    return ctx.db.select().from(adminAudit).orderBy(desc(adminAudit.id)).limit(200);
  });
}
