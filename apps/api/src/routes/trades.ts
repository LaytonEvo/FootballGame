import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import {
  acceptTrade,
  closeTrade,
  offerTrade,
  partnerCards,
  tradePartners,
  tradesScreen,
} from '../services/trading.js';
import { requireUser } from './auth.js';

export function tradeRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/trades', async (req) => tradesScreen(ctx, (await requireUser(ctx, req)).id));
  app.get('/trades/partners', async (req) => tradePartners(ctx.db, (await requireUser(ctx, req)).id));
  app.get('/trades/partners/:id/cards', async (req) => {
    const user = await requireUser(ctx, req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    return partnerCards(ctx, user.id, id);
  });
  app.post('/trades', async (req) => {
    const user = await requireUser(ctx, req);
    const body = z
      .object({ offeredCardId: z.string(), toUserId: z.string(), requestedCardId: z.string() })
      .parse(req.body);
    return offerTrade(ctx, user.id, body);
  });
  app.post('/trades/:id/:action', async (req) => {
    const user = await requireUser(ctx, req);
    const { id, action } = z
      .object({ id: z.string(), action: z.enum(['accept', 'decline', 'cancel']) })
      .parse(req.params);
    return action === 'accept' ? acceptTrade(ctx, user.id, id) : closeTrade(ctx, user.id, id, action);
  });
}
