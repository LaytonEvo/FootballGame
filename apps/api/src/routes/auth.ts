import type { FastifyInstance, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { users } from '../db/schema.js';
import type { NotificationKind } from '../services/notifications.js';
import { NOTIFICATION_KINDS } from '../services/notifications.js';
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
  app.post('/me/push-token', async (req) => {
    const user = await requireUser(ctx, req, { profile: false });
    const { token } = z.object({ token: z.string().min(10).max(200) }).parse(req.body);
    await ctx.db.update(users).set({ pushToken: token }).where(eq(users.id, user.id));
    return { ok: true };
  });
  app.put('/me/notifications', async (req) => {
    const user = await requireUser(ctx, req, { profile: false });
    const kinds = Object.keys(NOTIFICATION_KINDS) as [NotificationKind, ...NotificationKind[]];
    const body = z.partialRecord(z.enum(kinds), z.boolean()).parse(req.body);
    const prefs = { ...(user.notificationPrefs as Record<string, boolean>), ...body };
    await ctx.db.update(users).set({ notificationPrefs: prefs }).where(eq(users.id, user.id));
    return { notificationPrefs: prefs };
  });
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
