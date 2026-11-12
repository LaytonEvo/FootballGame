import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { cards, clubs, players } from '../db/schema.js';
import { getPacksConfig } from '../services/config.js';
import { listPacks, oddsFor, openPack } from '../services/packs.js';
import { getSquad, placeCard, setSquad } from '../services/squad.js';
import { track } from '../services/analytics.js';
import { requireUser } from './auth.js';
import { playerProfile } from '../services/player-profile.js';

export function cardRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/clubs', async () =>
    (
      await ctx.db
        .select({ id: clubs.id, code: clubs.code, name: clubs.name, inLeague: clubs.inLeague })
        .from(clubs)
    ).sort((a, b) => a.name.localeCompare(b.name)),
  );

  app.get('/packs', async (req) => listPacks(ctx.db, (await requireUser(ctx, req)).id));
  app.get('/packs/odds', async () => {
    const cfg = await getPacksConfig(ctx.db);
    const types = ['starter', 'player', 'squad', 'silver', 'gold', 'elite'] as const;
    return {
      version: cfg.version,
      odds: Object.fromEntries(types.map((t) => [t, oddsFor(cfg, { type: t, rarity: null })])),
    };
  });
  app.post('/packs/:id/open', async (req) => {
    const user = await requireUser(ctx, req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const res = await openPack(ctx.db, ctx.clock.now(), user.id, id);
    await track(ctx.db, ctx.clock.now(), user.id, 'pack_opened', {
      type: res.pack.type,
      source: res.pack.source,
    });
    return res;
  });

  app.get('/cards', async (req) => {
    const user = await requireUser(ctx, req);
    return ctx.db
      .select({
        card: cards,
        player: { name: players.name, position: players.position, shirtNumber: players.shirtNumber },
        clubCode: clubs.code,
      })
      .from(cards)
      .innerJoin(players, eq(players.id, cards.playerId))
      .leftJoin(clubs, eq(clubs.id, players.clubId))
      .where(and(eq(cards.userId, user.id)));
  });

  app.get('/players/:id', async (req) => {
    const user = await requireUser(ctx, req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    return playerProfile(ctx.db, id, user.id);
  });

  app.get('/squad', async (req) => getSquad(ctx.db, (await requireUser(ctx, req)).id));
  app.put('/squad', async (req) => {
    const user = await requireUser(ctx, req);
    const body = z.object({ slots: z.array(z.string().nullable()).min(5).max(6) }).parse(req.body);
    const squad = await setSquad(ctx.db, user.id, body.slots);
    await track(ctx.db, ctx.clock.now(), user.id, 'squad_updated', {});
    return squad;
  });
  app.post('/squad/place', async (req) => {
    const user = await requireUser(ctx, req);
    const body = z.object({ cardId: z.string(), slot: z.number().int().min(0).max(5) }).parse(req.body);
    return placeCard(ctx.db, user.id, body.cardId, body.slot);
  });
}
