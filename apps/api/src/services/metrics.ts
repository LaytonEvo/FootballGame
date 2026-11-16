import { and, inArray, isNotNull } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { analyticsEvents, gameweeks, leagueMembers, users } from '../db/schema.js';

/**
 * The six closed-test metrics from CLAUDE.md, computed from analytics events (server clock only).
 *
 * Definitions:
 * - Active player: confirmed actions in the last 28 days.
 * - Install: account creation (the first thing a new player does after opening the app).
 * - Week-1 cohort: players who confirmed in the first gameweek anyone confirmed in.
 * - Returning player (pick time): has confirmed in an earlier gameweek.
 */

const DAY = 24 * 60 * 60 * 1000;
export const ACTIVE_WINDOW_DAYS = 28;
const RETENTION_WEEK = 8;

export type MetricStatus = 'met' | 'not_met' | 'no_data';
export interface Metric {
  key: string;
  label: string;
  target: string;
  value: number | null;
  display: string;
  status: MetricStatus;
  sample: number;
  note: string;
}
export interface MetricsReport {
  generatedAt: Date;
  activeWindowDays: number;
  activePlayers: number;
  metrics: Metric[];
  funnel: { step: string; users: number }[];
  retention: { gameweek: number; week: number; active: number; percent: number }[];
  weekly: { gameweek: number; players: number; medianPickSeconds: number | null; shares: number }[];
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const secs = (ms: number) => Math.round(ms / 1000);
const fmtDuration = (ms: number) => {
  const s = secs(ms);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};

interface Confirm {
  userId: string;
  at: Date;
  gameweek: number;
  pickMs: number | null;
}

export async function computeMetrics(ctx: AppContext): Promise<MetricsReport> {
  const now = ctx.clock.now();
  const since = new Date(now.getTime() - ACTIVE_WINDOW_DAYS * DAY);

  const events = await ctx.db
    .select({
      userId: analyticsEvents.userId,
      name: analyticsEvents.name,
      props: analyticsEvents.props,
      at: analyticsEvents.at,
    })
    .from(analyticsEvents)
    .where(
      and(
        isNotNull(analyticsEvents.userId),
        inArray(analyticsEvents.name, [
          'actions_confirmed',
          'recap_shared',
          'invite_accepted',
          'pack_opened',
          'profile_completed',
        ]),
      ),
    );
  const allUsers = await ctx.db.select({ id: users.id, createdAt: users.createdAt }).from(users);
  const createdAt = new Map(allUsers.map((u) => [u.id, u.createdAt]));

  // ---- confirms: first confirm per user per gameweek is the weekly pick ----
  const confirms: Confirm[] = events
    .filter((e) => e.name === 'actions_confirmed')
    .map((e) => {
      const p = e.props as { gameweek?: number; pickMs?: number | null };
      return { userId: e.userId!, at: e.at, gameweek: Number(p.gameweek), pickMs: p.pickMs ?? null };
    })
    .filter((c) => Number.isFinite(c.gameweek))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const weeklyPick = new Map<string, Confirm>();
  for (const c of confirms) {
    const k = `${c.userId}:${c.gameweek}`;
    if (!weeklyPick.has(k)) weeklyPick.set(k, c);
  }
  const gwsByUser = new Map<string, Set<number>>();
  for (const c of weeklyPick.values()) {
    if (!gwsByUser.has(c.userId)) gwsByUser.set(c.userId, new Set());
    gwsByUser.get(c.userId)!.add(c.gameweek);
  }

  const active = new Set(confirms.filter((c) => c.at >= since).map((c) => c.userId));
  const metrics: Metric[] = [];

  // 1. Install to first actions locked
  const firstConfirm = new Map<string, Date>();
  for (const c of confirms) if (!firstConfirm.has(c.userId)) firstConfirm.set(c.userId, c.at);
  const toFirst = [...firstConfirm]
    .map(([u, at]) => (createdAt.has(u) ? at.getTime() - createdAt.get(u)!.getTime() : null))
    .filter((x): x is number => x !== null && x >= 0);
  const m1 = median(toFirst);
  metrics.push({
    key: 'install_to_first_lock',
    label: 'Install to first actions locked',
    target: 'under 2 minutes (median)',
    value: m1 === null ? null : secs(m1),
    display: m1 === null ? '–' : fmtDuration(m1),
    status: m1 === null ? 'no_data' : m1 < 2 * 60 * 1000 ? 'met' : 'not_met',
    sample: toFirst.length,
    note: `Account created → first confirm. ${pct(toFirst.filter((x) => x < 120_000).length, toFirst.length)}% under 2 min.`,
  });

  // 2. Time to pick weekly actions (returning players)
  const returningPicks = [...weeklyPick.values()].filter(
    (c) => c.pickMs !== null && [...(gwsByUser.get(c.userId) ?? [])].some((g) => g < c.gameweek),
  );
  const m2 = median(returningPicks.map((c) => c.pickMs!));
  metrics.push({
    key: 'pick_time',
    label: 'Time to pick weekly actions',
    target: 'under 60 seconds (median, returning players)',
    value: m2 === null ? null : secs(m2),
    display: m2 === null ? '–' : fmtDuration(m2),
    status: m2 === null ? 'no_data' : m2 < 60_000 ? 'met' : 'not_met',
    sample: returningPicks.length,
    note: `First open of the picks screen → confirm, for players who also played an earlier gameweek. ${pct(returningPicks.filter((c) => c.pickMs! < 60_000).length, returningPicks.length)}% under 60s.`,
  });

  // 3. Gameweek retention
  const playedGws = [...new Set([...weeklyPick.values()].map((c) => c.gameweek))].sort((a, b) => a - b);
  const firstGw = playedGws[0];
  const cohort = new Set([...weeklyPick.values()].filter((c) => c.gameweek === firstGw).map((c) => c.userId));
  const retention =
    firstGw === undefined
      ? []
      : Array.from({ length: playedGws[playedGws.length - 1]! - firstGw + 1 }, (_, i) => {
          const gw = firstGw + i;
          const n = [...cohort].filter((u) => gwsByUser.get(u)?.has(gw)).length;
          return { gameweek: gw, week: i + 1, active: n, percent: pct(n, cohort.size) };
        });
  const wk8 = retention.find((r) => r.week === RETENTION_WEEK);
  const latest = retention[retention.length - 1];
  metrics.push({
    key: 'retention',
    label: `Gameweek retention (week ${RETENTION_WEEK})`,
    target: `60%+ of week-1 players active at week ${RETENTION_WEEK}`,
    value: wk8?.percent ?? latest?.percent ?? null,
    display: wk8 ? `${wk8.percent}%` : latest ? `${latest.percent}% (week ${latest.week})` : '–',
    status: !wk8 ? 'no_data' : wk8.percent >= 60 ? 'met' : 'not_met',
    sample: cohort.size,
    note:
      firstGw === undefined
        ? 'No gameweek played yet.'
        : `Week 1 = GW${firstGw}. Active = confirmed actions that gameweek (carried-over picks don't count).${wk8 ? '' : ` Week ${RETENTION_WEEK} not reached yet.`}`,
  });

  // 4. Mini-league membership
  const members = new Set(
    (await ctx.db.selectDistinct({ userId: leagueMembers.userId }).from(leagueMembers)).map((r) => r.userId),
  );
  const inLeague = [...active].filter((u) => members.has(u)).length;
  metrics.push(
    rate(
      'league_membership',
      'Mini-league membership',
      '70%+ of active players in at least one',
      inLeague,
      active.size,
      70,
      'Private mini-leagues only (the global table does not count).',
    ),
  );

  // 5. Recap shares (last 28 days)
  const sharers = new Set(
    events.filter((e) => e.name === 'recap_shared' && e.at >= since).map((e) => e.userId!),
  );
  const activeSharers = [...active].filter((u) => sharers.has(u)).length;
  metrics.push(
    rate(
      'recap_shares',
      'Recap shares',
      '15%+ of active players share at least once a month',
      activeSharers,
      active.size,
      15,
      `Shared a recap in the last ${ACTIVE_WINDOW_DAYS} days.`,
    ),
  );

  // 6. Invites per active player (whole test window)
  const invites = events.filter(
    (e) => e.name === 'invite_accepted' && (e.props as { by?: string }).by !== e.userId,
  ).length;
  const perActive = active.size ? Math.round((invites / active.size) * 100) / 100 : null;
  metrics.push({
    key: 'invites',
    label: 'Invites per active player',
    target: '0.5+ over the test window',
    value: perActive,
    display: perActive === null ? '–' : perActive.toFixed(2),
    status: perActive === null ? 'no_data' : perActive >= 0.5 ? 'met' : 'not_met',
    sample: active.size,
    note: `${invites} people joined a mini-league through someone's invite since the test began.`,
  });

  // ---- funnel and weekly table ----
  const distinct = (name: string) => new Set(events.filter((e) => e.name === name).map((e) => e.userId)).size;
  const funnel = [
    { step: 'Accounts created', users: allUsers.length },
    { step: 'Profile completed', users: distinct('profile_completed') },
    { step: 'Opened a pack', users: distinct('pack_opened') },
    { step: 'Confirmed actions', users: firstConfirm.size },
    { step: 'Played 2+ gameweeks', users: [...gwsByUser.values()].filter((s) => s.size >= 2).length },
    { step: `Active (last ${ACTIVE_WINDOW_DAYS} days)`, users: active.size },
  ];
  const sharesByGw = new Map<number, number>();
  const gwNumber = new Map(
    (await ctx.db.select({ id: gameweeks.id, number: gameweeks.number }).from(gameweeks)).map((g) => [
      g.id,
      g.number,
    ]),
  );
  for (const e of events.filter((x) => x.name === 'recap_shared')) {
    const g = gwNumber.get(String((e.props as { gameweekId?: string }).gameweekId));
    if (g !== undefined) sharesByGw.set(g, (sharesByGw.get(g) ?? 0) + 1);
  }
  const weekly = playedGws.map((g) => {
    const picks = [...weeklyPick.values()].filter((c) => c.gameweek === g);
    const m = median(picks.filter((c) => c.pickMs !== null).map((c) => c.pickMs!));
    return {
      gameweek: g,
      players: picks.length,
      medianPickSeconds: m === null ? null : secs(m),
      shares: sharesByGw.get(g) ?? 0,
    };
  });

  return {
    generatedAt: now,
    activeWindowDays: ACTIVE_WINDOW_DAYS,
    activePlayers: active.size,
    metrics,
    funnel,
    retention,
    weekly,
  };
}

function rate(
  key: string,
  label: string,
  target: string,
  n: number,
  d: number,
  threshold: number,
  note: string,
): Metric {
  const v = d ? pct(n, d) : null;
  return {
    key,
    label,
    target,
    value: v,
    display: v === null ? '–' : `${v}%`,
    status: v === null ? 'no_data' : v >= threshold ? 'met' : 'not_met',
    sample: d,
    note: `${n} of ${d}. ${note}`,
  };
}
