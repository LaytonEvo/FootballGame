import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { track } from '../services/analytics.js';
import { homeScreen } from '../services/home.js';
import { confirmSelection, currentGameweek, pickScreen, suggest } from '../services/picks.js';
import { requireUser } from './auth.js';

const selectionInput = z.object({
  actions: z.array(z.array(z.string()).max(4)).min(5).max(6),
  captain: z.number().int().min(0).max(4).nullable(),
  bold: z.object({ slot: z.number().int().min(0).max(5), actionId: z.string() }).nullable(),
});

export function pickRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/gameweeks/current', async () => {
    const gw = await currentGameweek(ctx.db);
    return { gameweek: gw, serverTime: ctx.clock.now() };
  });
  app.get('/home', async (req) => homeScreen(ctx, (await requireUser(ctx, req)).id));
  app.get('/picks', async (req) => {
    const user = await requireUser(ctx, req);
    const { gameweekId } = z.object({ gameweekId: z.string().optional() }).parse(req.query);
    const screen = await pickScreen(ctx, user.id, gameweekId);
    if (!screen.locked)
      await track(ctx.db, ctx.clock.now(), user.id, 'pick_started', { gameweekId: screen.gameweek.id });
    return screen;
  });
  app.post('/picks/suggest', async (req) => {
    const user = await requireUser(ctx, req);
    const body = z
      .object({ kind: z.enum(['last_week', 'auto']), draft: selectionInput.optional() })
      .parse(req.body);
    return suggest(ctx, user.id, body.kind, body.draft);
  });
  app.post('/picks/:gameweekId/confirm', async (req) => {
    const user = await requireUser(ctx, req);
    const { gameweekId } = z.object({ gameweekId: z.string() }).parse(req.params);
    return confirmSelection(ctx, user.id, gameweekId, selectionInput.parse(req.body));
  });
}
