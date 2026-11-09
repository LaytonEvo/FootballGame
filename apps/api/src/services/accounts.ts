import { randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { DISCLAIMER } from '@ff/shared';
import type { AppContext } from '../context.js';
import { DAY } from '../clock.js';
import { clubs, sessions, users } from '../db/schema.js';
import { badRequest, HttpError } from '../errors.js';
import { newId, sha256, shortCode } from '../ids.js';
import { track } from './analytics.js';
import { grantPack } from './packs.js';
import { hashPhone, normalisePhone } from './phone.js';

export const SESSION_TTL_MS = 180 * DAY;
export const MIN_AGE = 16;

export type User = typeof users.$inferSelect;

export async function startSignIn(ctx: AppContext, rawPhone: string) {
  const phone = normalisePhone(rawPhone);
  const phoneHash = hashPhone(phone);
  await ctx.otp.start(phone, phoneHash);
  await track(ctx.db, ctx.clock.now(), null, 'signup_started', {});
  return { sent: true };
}

export async function verifySignIn(ctx: AppContext, rawPhone: string, code: string) {
  const phone = normalisePhone(rawPhone);
  const phoneHash = hashPhone(phone);
  if (!/^\d{4,8}$/.test(code) || !(await ctx.otp.check(phone, phoneHash, code))) {
    throw new HttpError(401, 'bad_code', 'That code is not right. Try again or request a new one.');
  }
  const now = ctx.clock.now();
  let [user] = await ctx.db.select().from(users).where(eq(users.phoneHash, phoneHash));
  const isNew = !user;
  if (!user) {
    [user] = await ctx.db
      .insert(users)
      .values({ id: newId(), phoneHash, inviteCode: shortCode(8) })
      .returning();
  }
  const token = randomBytes(32).toString('base64url');
  await ctx.db.insert(sessions).values({
    tokenHash: sha256(token),
    userId: user!.id,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
  });
  await track(ctx.db, now, user!.id, 'signup_verified', { isNew });
  return { token, user: publicUser(user!), isNew };
}

export async function userForToken(ctx: AppContext, token: string): Promise<User | null> {
  const [row] = await ctx.db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, ctx.clock.now())));
  return row?.user ?? null;
}

export const profileComplete = (u: User) => !!(u.displayName && u.ageConfirmedAt && u.disclaimerAcceptedAt);

export function publicUser(u: User) {
  return {
    id: u.id,
    displayName: u.displayName,
    favouriteClubId: u.favouriteClubId,
    inviteCode: u.inviteCode,
    profileComplete: profileComplete(u),
    notificationPrefs: u.notificationPrefs,
  };
}

export interface ProfileInput {
  displayName: string;
  favouriteClubId?: string | null;
  /** The user confirms they are 16 or over. */
  ageConfirmed: boolean;
  /** The user accepts the disclaimer text exactly as shown. */
  disclaimerAccepted: boolean;
}

/** Complete sign-up: display name, favourite club (content only), 16+ confirmation, disclaimer. Grants the starter pack. */
export async function completeProfile(ctx: AppContext, user: User, input: ProfileInput) {
  const name = input.displayName?.trim() ?? '';
  if (name.length < 2 || name.length > 20)
    throw badRequest('bad_name', 'Display name must be 2-20 characters');
  if (!/^[\p{L}\p{N} ._'-]+$/u.test(name))
    throw badRequest('bad_name', "Use letters, numbers, spaces and . _ ' -");
  if (!input.ageConfirmed) throw badRequest('age_required', `You must be ${MIN_AGE} or over to play`);
  if (!input.disclaimerAccepted) throw badRequest('disclaimer_required', `Please accept: ${DISCLAIMER}`);
  if (input.favouriteClubId) {
    const [c] = await ctx.db.select().from(clubs).where(eq(clubs.id, input.favouriteClubId));
    if (!c) throw badRequest('bad_club', 'Unknown club');
  }
  const now = ctx.clock.now();
  const [updated] = await ctx.db
    .update(users)
    .set({
      displayName: name,
      favouriteClubId: input.favouriteClubId ?? null,
      ageConfirmedAt: user.ageConfirmedAt ?? now,
      disclaimerAcceptedAt: user.disclaimerAcceptedAt ?? now,
    })
    .where(eq(users.id, user.id))
    .returning();
  const { pack } = await grantPack(ctx.db, now, user.id, 'starter', 'signup', `starter:${user.id}`);
  await track(ctx.db, now, user.id, 'profile_completed', {});
  return { user: publicUser(updated!), starterPackId: pack.id };
}
