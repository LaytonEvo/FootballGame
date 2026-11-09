import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { forbidden, HttpError } from '../errors.js';
import type { User } from '../services/accounts.js';
import {
  completeProfile,
  profileComplete,
  publicUser,
  startSignIn,
  userForToken,
  verifySignIn,
} from '../services/accounts.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
  }
}

export async function requireUser(
  ctx: AppContext,
  req: FastifyRequest,
  opts: { profile?: boolean } = { profile: true },
): Promise<User> {
  const h = req.headers.authorization;
  const token = h?.startsWith('Bearer ') ? h.slice(7) : null;
  const user = token ? await userForToken(ctx, token) : null;
  if (!user) throw new HttpError(401, 'unauthenticated', 'Sign in first');
  if (opts.profile !== false && !profileComplete(user))
    throw forbidden('profile_incomplete', 'Finish setting up your profile');
  return user;
}

export function authRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post('/auth/start', async (req) => {
    const body = z.object({ phone: z.string().min(6).max(20) }).parse(req.body);
    return startSignIn(ctx, body.phone);
  });
  app.post('/auth/verify', async (req) => {
    const body = z
      .object({ phone: z.string().min(6).max(20), code: z.string().min(4).max(8) })
      .parse(req.body);
    return verifySignIn(ctx, body.phone, body.code);
  });
  app.get('/me', async (req) => publicUser(await requireUser(ctx, req, { profile: false })));
  app.post('/me/profile', async (req) => {
    const user = await requireUser(ctx, req, { profile: false });
    const body = z
      .object({
        displayName: z.string(),
        favouriteClubId: z.string().nullable().optional(),
        ageConfirmed: z.boolean(),
        disclaimerAccepted: z.boolean(),
      })
      .parse(req.body);
    return completeProfile(ctx, user, body);
  });
}
