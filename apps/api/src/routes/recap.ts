import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { track } from '../services/analytics.js';
import { inviteLinks } from '../services/leagues.js';
import { recapFor } from '../services/recap.js';
import { renderShareCard } from '../services/share-card.js';
import { requireUser } from './auth.js';

export function recapRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/recap/:gameweekId', async (req) => {
    const user = await requireUser(ctx, req);
    const { gameweekId } = z.object({ gameweekId: z.string() }).parse(req.params);
    const recap = await recapFor(ctx, user.id, gameweekId);
    await track(ctx.db, ctx.clock.now(), user.id, 'recap_viewed', { gameweek: recap.gameweek.number });
    return { ...recap, invite: inviteLinks(recap.inviteCode) };
  });
  app.get('/recap/:gameweekId/share.png', async (req, reply) => {
    const user = await requireUser(ctx, req);
    const { gameweekId } = z.object({ gameweekId: z.string() }).parse(req.params);
    const { format } = z.object({ format: z.enum(['story', 'square']).default('story') }).parse(req.query);
    const recap = await recapFor(ctx, user.id, gameweekId);
    const png = await renderShareCard(recap, format, inviteLinks(recap.inviteCode).url);
    return reply
      .header('content-type', 'image/png')
      .header('cache-control', 'private, max-age=300')
      .send(png);
  });
  app.post('/recap/:gameweekId/shared', async (req) => {
    const user = await requireUser(ctx, req);
    const { gameweekId } = z.object({ gameweekId: z.string() }).parse(req.params);
    const { format, channel } = z
      .object({ format: z.enum(['story', 'square']), channel: z.string().max(40).optional() })
      .parse(req.body);
    await track(ctx.db, ctx.clock.now(), user.id, 'recap_shared', {
      gameweekId,
      format,
      channel: channel ?? null,
    });
    return { ok: true };
  });
}
