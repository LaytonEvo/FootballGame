import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { forbidden } from '../errors.js';
import { track } from '../services/analytics.js';
import {
  createLeague,
  inviteLinks,
  joinLeague,
  leagueByCode,
  leaveLeague,
  memberIds,
  myLeagues,
  mySeason,
  table,
} from '../services/leagues.js';
import type { TableView } from '../services/leagues.js';
import { requireUser } from './auth.js';

const viewQuery = z.object({
  view: z.enum(['season', 'week', 'month']).default('season'),
  gameweekId: z.string().optional(),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
});
const toView = (q: z.infer<typeof viewQuery>): TableView =>
  q.view === 'week' && q.gameweekId
    ? { kind: 'week', gameweekId: q.gameweekId }
    : q.view === 'month' && q.month
      ? { kind: 'month', month: q.month }
      : { kind: 'season' };

export function leagueRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/leagues', async (req) => {
    const user = await requireUser(ctx, req);
    return Promise.all(
      (await myLeagues(ctx.db, user.id)).map(async (l) => {
        const rows = await table(ctx.db, { kind: 'season' }, await memberIds(ctx.db, l.id));
        const me = rows.find((r) => r.userId === user.id);
        return {
          ...l,
          ...inviteLinks(l.code),
          size: rows.length,
          rank: me?.rank ?? null,
          points: me?.points ?? 0,
        };
      }),
    );
  });
  app.post('/leagues', async (req) => {
    const user = await requireUser(ctx, req);
    const { name } = z.object({ name: z.string() }).parse(req.body);
    const l = await createLeague(ctx, user.id, name);
    return { ...l, ...inviteLinks(l.code) };
  });
  /** Public preview for the invite landing (no sign-in needed). */
  app.get('/invites/:code', async (req) => {
    const { code } = z.object({ code: z.string().min(4).max(12) }).parse(req.params);
    const l = await leagueByCode(ctx.db, code, ctx.clock.now());
    await track(ctx.db, ctx.clock.now(), null, 'invite_link_opened', { leagueId: l.id });
    return { name: l.name, members: (await memberIds(ctx.db, l.id)).length };
  });
  app.post('/leagues/join', async (req) => {
    const user = await requireUser(ctx, req);
    const { code } = z.object({ code: z.string().min(4).max(12) }).parse(req.body);
    const l = await joinLeague(ctx, user.id, code);
    return { id: l.id, name: l.name };
  });
  app.post('/leagues/:id/leave', async (req) => {
    const user = await requireUser(ctx, req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await leaveLeague(ctx, user.id, id);
    return { ok: true };
  });
  app.get('/leagues/global', async (req) => {
    const user = await requireUser(ctx, req);
    const rows = await table(ctx.db, toView(viewQuery.parse(req.query)), null);
    const me = rows.find((r) => r.userId === user.id) ?? null;
    return { name: 'Global', size: rows.length, rows: rows.slice(0, 100), me };
  });
  app.get('/leagues/:id', async (req) => {
    const user = await requireUser(ctx, req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const ids = await memberIds(ctx.db, id);
    if (!ids.includes(user.id)) throw forbidden('not_member', 'Join this league to see its table');
    const l = (await myLeagues(ctx.db, user.id)).find((x) => x.id === id)!;
    const rows = await table(ctx.db, toView(viewQuery.parse(req.query)), ids);
    return {
      ...l,
      ...inviteLinks(l.code),
      size: rows.length,
      rows,
      me: rows.find((r) => r.userId === user.id) ?? null,
    };
  });
  app.get('/me/season', async (req) => {
    const user = await requireUser(ctx, req);
    const { leagueId } = z.object({ leagueId: z.string().optional() }).parse(req.query);
    return mySeason(ctx.db, user.id, leagueId ?? null);
  });
}
