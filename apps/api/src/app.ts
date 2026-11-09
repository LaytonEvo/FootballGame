import Fastify from 'fastify';
import cors from '@fastify/cors';
import { DISCLAIMER } from '@ff/shared';
import type { AppContext } from './context.js';
import { getEconomy, getScoringConfig } from './services/config.js';

export async function buildApp(ctx: AppContext) {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' && !process.env.VITEST });
  await app.register(cors, { origin: true });

  app.get('/health', async () => ({ ok: true, time: ctx.clock.now().toISOString() }));
  app.get('/meta', async () => ({ disclaimer: DISCLAIMER, serverTime: ctx.clock.now().toISOString() }));
  app.get('/config/active', async () => {
    const [scoring, economy] = await Promise.all([getScoringConfig(ctx.db), getEconomy(ctx.db)]);
    return { scoring, economy };
  });
  return app;
}
