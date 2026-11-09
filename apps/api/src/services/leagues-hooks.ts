import { onFinalise } from '../jobs/hooks.js';
import { registerHomeExtra } from './home.js';
import { leagueMovesFor, memberIds, myLeagues, table } from './leagues.js';
import { setLeagueMovesProvider } from './live.js';
import { notify } from './notifications.js';

setLeagueMovesProvider(leagueMovesFor);

/** Home league card: the most recently joined league (null = show "create a league"). */
registerHomeExtra(async (ctx, userId) => {
  const [l] = await myLeagues(ctx.db, userId);
  if (!l) return { league: null };
  const rows = await table(ctx.db, { kind: 'season' }, await memberIds(ctx.db, l.id));
  const me = rows.find((r) => r.userId === userId);
  const above = me ? rows.find((r) => r.rank === me.rank - 1) : undefined;
  return {
    league: me
      ? {
          id: l.id,
          name: l.name,
          rank: me.rank,
          size: rows.length,
          points: me.points,
          gapAbove: above ? above.points - me.points : null,
        }
      : null,
  };
});

/** "Overtaken in a mini-league" (off by default): after finalisation, anyone whose rank dropped. */
onFinalise(async (ctx, f) => {
  const now = ctx.clock.now();
  const seen = new Set<string>();
  for (const u of f.scored) {
    for (const l of await myLeagues(ctx.db, u.userId)) {
      if (seen.has(l.id)) continue;
      seen.add(l.id);
      const rows = await table(ctx.db, { kind: 'season' }, await memberIds(ctx.db, l.id));
      for (const r of rows) {
        if (r.previousRank !== null && r.rank > r.previousRank) {
          const by = rows.find(
            (x) => x.rank < r.rank && x.previousRank !== null && x.previousRank > r.previousRank!,
          );
          await notify(ctx.db, now, {
            userId: r.userId,
            kind: 'league_overtaken',
            title: `${l.name}: you dropped to ${r.rank}`,
            body: by
              ? `${by.name} overtook you in GW${f.gameweek.number}.`
              : `Down from ${r.previousRank} after GW${f.gameweek.number}.`,
            data: { route: `/league/${l.id}` },
            dedupeKey: `overtaken:${l.id}:${f.gameweek.id}:${r.userId}`,
          });
        }
      }
    }
  }
});
