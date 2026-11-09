import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { buyPack, rewardsScreen, swapCard } from '../services/coins.js';
import { requireUser } from './auth.js';

export function rewardRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/rewards', async (req) => rewardsScreen(ctx, (await requireUser(ctx, req)).id));
  app.post('/shop/buy', async (req) => {
    const user = await requireUser(ctx, req);
    const { item } = z.object({ item: z.enum(['player_pack', 'squad_pack']) }).parse(req.body);
    const key = z.string().min(8).max(80).parse(req.headers['idempotency-key']);
    return buyPack(ctx, user.id, item, key);
  });
  app.post('/cards/:id/swap', async (req) => {
    const user = await requireUser(ctx, req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    return swapCard(ctx, user.id, id);
  });
}
