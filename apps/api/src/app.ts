import Fastify from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import { DISCLAIMER } from '@ff/shared';
import type { AppContext } from './context.js';
import { HttpError } from './errors.js';
import { authRoutes } from './routes/auth.js';
import { cardRoutes } from './routes/cards.js';
import { pickRoutes } from './routes/picks.js';
import { getEconomy, getScoringConfig } from './services/config.js';
import { phoneSignInRequired } from './services/accounts.js';
import './services/live.js';
import './services/leagues-hooks.js';
import './services/coins-hooks.js';
import './services/recap-hooks.js';
import { rewardRoutes } from './routes/rewards.js';
import { recapRoutes } from './routes/recap.js';
import { adminRoutes } from './routes/admin.js';
import { leagueRoutes } from './routes/leagues.js';

export async function buildApp(ctx: AppContext) {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' && !process.env.VITEST });
  await app.register(cors, { origin: true });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError)
      return reply.status(err.status).send({ error: err.code, message: err.message, details: err.details });
    if (err instanceof ZodError)
      return reply
        .status(400)
        .send({ error: 'bad_request', message: 'Invalid request', details: err.issues });
    app.log.error(err);
    return reply.status(500).send({ error: 'internal', message: 'Something went wrong' });
  });

  app.get('/health', async () => ({ ok: true, time: ctx.clock.now().toISOString() }));
  app.get('/meta', async () => ({
    disclaimer: DISCLAIMER,
    serverTime: ctx.clock.now().toISOString(),
    phoneSignIn: phoneSignInRequired(ctx),
  }));
  app.get('/config/active', async () => {
    const [scoring, economy] = await Promise.all([getScoringConfig(ctx.db), getEconomy(ctx.db)]);
    return { scoring, economy };
  });
  authRoutes(app, ctx);
  cardRoutes(app, ctx);
  pickRoutes(app, ctx);
  leagueRoutes(app, ctx);
  rewardRoutes(app, ctx);
  recapRoutes(app, ctx);
  adminRoutes(app, ctx);
  return app;
}
