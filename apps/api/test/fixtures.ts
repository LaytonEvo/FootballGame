import { eq, inArray } from 'drizzle-orm';
import { loadDataset } from '@ff/fpl-dataset';
import type { Position, Rarity } from '@ff/shared';
import type { FakeClock } from '../src/clock.js';
import type { AppContext } from '../src/context.js';
import type { Db } from '../src/db/client.js';
import { cards, players, squadSlots, users } from '../src/db/schema.js';
import { newId, sha256, shortCode } from '../src/ids.js';
import { FplDatasetProvider } from '../src/providers/fpl-dataset.js';
import { syncReferenceData } from '../src/services/ingest.js';
import { LocalOtpService } from '../src/services/otp.js';
import { testCtx } from './helpers.js';
import type { buildApp } from '../src/app.js';
import { hashPhone, normalisePhone } from '../src/services/phone.js';

export const ds = loadDataset();

export async function datasetCtx(gameweeks: number[], start = '2026-08-01T12:00:00Z') {
  const t = await testCtx(start);
  const provider = new FplDatasetProvider({ clock: t.clock, gameweeks });
  const otp = new LocalOtpService(t.db, t.clock);
  const ctx: AppContext & { clock: FakeClock; otp: LocalOtpService } = {
    db: t.db,
    clock: t.clock,
    provider,
    otp,
  };
  await syncReferenceData(ctx);
  return { ...t, ctx, provider };
}

/** Pick dataset players (by element id) who match a predicate in a gameweek, distinct teams. */
export function findPlayers(
  gw: number,
  wants: { position: Position; where?: (m: (typeof ds.playerMatches)[number]) => boolean }[],
) {
  const used = new Set<number>();
  const teams = new Map<number, number>();
  return wants.map((w) => {
    const m = ds.playerMatches.find(
      (x) =>
        x.gameweek === gw &&
        x.position === w.position &&
        !used.has(x.playerId) &&
        (teams.get(x.teamId) ?? 0) < 2 &&
        (w.where ? w.where(x) : x.stats.minutes >= 60),
    );
    if (!m) throw new Error(`No player for ${w.position} in GW${gw}`);
    used.add(m.playerId);
    teams.set(m.teamId, (teams.get(m.teamId) ?? 0) + 1);
    return m;
  });
}

/** Create a user owning cards for the given dataset elements, placed in slots 0..5. */
export async function userWithSquad(db: Db, elements: number[], rarity: Rarity = 'gold') {
  const userId = newId();
  await db.insert(users).values({
    id: userId,
    phoneHash: sha256(userId),
    displayName: `u-${userId.slice(0, 4)}`,
    inviteCode: shortCode(8),
  });
  const refs = elements.map((e) => `fpl:p${e}`);
  const rows = await db.select().from(players).where(inArray(players.providerRef, refs));
  for (const [slot, ref] of refs.entries()) {
    const p = rows.find((r) => r.providerRef === ref)!;
    const cardId = newId();
    await db
      .insert(cards)
      .values({ id: cardId, userId, playerId: p.id, rarity, rating: p.rating, clubAtOpeningId: p.clubId });
    await db.insert(squadSlots).values({ userId, slot, cardId });
  }
  return userId;
}

export async function playerIdFor(db: Db, element: number) {
  const [p] = await db
    .select()
    .from(players)
    .where(eq(players.providerRef, `fpl:p${element}`));
  return p!.id;
}

type T = Awaited<ReturnType<typeof datasetCtx>>;
export async function signUp(
  app: Awaited<ReturnType<typeof buildApp>>,
  t: T,
  phone: string,
  name = 'Tester',
) {
  await app.inject({ method: 'POST', url: '/auth/start', payload: { phone } });
  const code = t.ctx.otp.sent.get(hashPhone(normalisePhone(phone)))!;
  const v = await app.inject({ method: 'POST', url: '/auth/verify', payload: { phone, code } });
  const token = v.json().token as string;
  const headers = { authorization: `Bearer ${token}` };
  const p = await app.inject({
    method: 'POST',
    url: '/me/profile',
    headers,
    payload: { displayName: name, ageConfirmed: true, disclaimerAccepted: true },
  });
  return { headers, starterPackId: p.json().starterPackId as string, userId: v.json().user.id as string };
}
