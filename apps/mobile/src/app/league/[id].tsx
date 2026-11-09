import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useApi } from '../../lib/useApi';
import type { HomeData } from '../../lib/home';
import { color, font, radius, type } from '../../lib/theme';
import { Button, Card, H1, H3, Loading, Screen, Small } from '../../components/ui';
import { shareInvite } from '../../lib/invite';

interface Row {
  userId: string;
  name: string;
  points: number;
  landed: number;
  picked: number;
  rank: number;
  previousRank: number | null;
}
interface TableData {
  name: string;
  code?: string;
  url?: string;
  size: number;
  rows: Row[];
  me: Row | null;
}
interface Season {
  total: number;
  average: number;
  best: { number: number; points: number } | null;
  weeks: {
    gameweekId: string;
    number: number;
    points: number | null;
    landed: number;
    picked: number;
    average: number | null;
  }[];
}

export default function LeagueTable() {
  const { id, fromInvite } = useLocalSearchParams<{ id: string; fromInvite?: string }>();
  const [view, setView] = useState<'season' | 'week'>('season');
  const home = useApi<HomeData>('/home');
  const gwId = home.data?.gameweek?.id;
  const base = id === 'global' ? '/leagues/global' : `/leagues/${id}`;
  const path = view === 'week' ? (gwId ? `${base}?view=week&gameweekId=${gwId}` : null) : base;
  const data = useApi<TableData>(path, { pollMs: home.data?.mode === 'live' ? 60_000 : undefined });
  const season = useApi<Season>(id === 'global' ? '/me/season' : `/me/season?leagueId=${id}`);
  if (!data.data) return <Loading />;
  const d = data.data;
  const leader = d.rows[0];
  const maxPts = Math.max(
    1,
    ...(season.data?.weeks.map((w) => Math.max(w.points ?? 0, w.average ?? 0)) ?? [1]),
  );
  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}
        >
          <Text style={{ fontSize: 22, color: color.ink }}>‹</Text>
        </Pressable>
        <H1 style={{ flex: 1 }}>{d.name}</H1>
        {d.url && d.code ? (
          <Button
            title="Invite"
            variant="ghost"
            onPress={() => shareInvite({ name: d.name, url: d.url!, code: d.code! })}
          />
        ) : null}
      </View>
      {fromInvite ? (
        <Card>
          <H3>You're in {d.name}</H3>
          <Small>Set your actions for the next gameweek to start climbing the table.</Small>
          <Button
            title="Pick your actions"
            onPress={() => router.push({ pathname: '/picks', params: { guided: '1' } })}
          />
        </Card>
      ) : null}
      <View
        style={{
          flexDirection: 'row',
          backgroundColor: color.track,
          borderRadius: radius.button,
          padding: 4,
        }}
        accessibilityRole="tablist"
      >
        {(['season', 'week'] as const).map((v) => (
          <Pressable
            key={v}
            onPress={() => setView(v)}
            accessibilityRole="tab"
            accessibilityState={{ selected: view === v }}
            style={{
              flex: 1,
              minHeight: 40,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 10,
              backgroundColor: view === v ? color.surface : 'transparent',
            }}
          >
            <Text style={{ fontFamily: font.bodySemi, color: color.ink }}>
              {v === 'season' ? 'Season' : 'This week'}
            </Text>
          </Pressable>
        ))}
      </View>
      {d.me && leader ? (
        <Card style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <View>
            <Small>You</Small>
            <H3>
              {d.me.rank} of {d.size}
            </H3>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Small>{view === 'season' ? 'Behind 1st' : 'Week winner'}</Small>
            <H3>
              {view === 'season'
                ? `${leader.points - d.me.points} pts`
                : `${leader.userId === d.me.userId ? 'You' : leader.name}, ${leader.points} pts`}
            </H3>
          </View>
        </Card>
      ) : null}
      <Card style={{ padding: 0, gap: 0 }}>
        {d.rows.map((r, i) => {
          const me = r.userId === d.me?.userId;
          const delta = view === 'season' && r.previousRank !== null ? r.previousRank - r.rank : 0;
          return (
            <View
              key={r.userId}
              accessible
              accessibilityLabel={`${r.rank}, ${r.name}, ${r.points} points${delta ? `, ${delta > 0 ? 'up' : 'down'} ${Math.abs(delta)}` : ''}`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 14,
                minHeight: 48,
                backgroundColor: me ? color.landed.bg : color.surface,
                borderTopWidth: i ? 1 : 0,
                borderTopColor: color.divider,
              }}
            >
              <Text style={{ width: 28, fontFamily: font.heading, color: color.ink }}>{r.rank}</Text>
              <Text
                style={{
                  width: 34,
                  fontFamily: font.bodyBold,
                  fontSize: type.caption,
                  color: delta > 0 ? color.active : delta < 0 ? color.missed.border : color.muted,
                }}
              >
                {view === 'season' ? (delta > 0 ? `▲${delta}` : delta < 0 ? `▼${-delta}` : '–') : ''}
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: me ? font.bodyBold : font.bodySemi, color: color.ink }}>
                  {me ? 'You' : r.name}
                </Text>
                <Small>
                  {r.landed} of {r.picked} actions landed
                </Small>
              </View>
              <Text style={{ fontFamily: font.heading, color: color.ink }}>{r.points}</Text>
            </View>
          );
        })}
      </Card>
      <Small>Ties: most actions landed, then fewest actions picked.</Small>
      {season.data ? (
        <Card>
          <H3>My season</H3>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View>
              <Small>Total</Small>
              <H3>{season.data.total}</H3>
            </View>
            <View>
              <Small>Average</Small>
              <H3>{season.data.average}</H3>
            </View>
            <View>
              <Small>Best week</Small>
              <H3>{season.data.best ? `GW${season.data.best.number} · ${season.data.best.points}` : '—'}</H3>
            </View>
          </View>
          <View
            style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 110 }}
            accessibilityLabel="Points per gameweek with league average marks"
          >
            {season.data.weeks.map((w) => (
              <View
                key={w.gameweekId}
                style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: 110 }}
              >
                {w.average !== null ? (
                  <View
                    style={{
                      position: 'absolute',
                      bottom: 14 + (w.average / maxPts) * 90,
                      width: '100%',
                      height: 2,
                      backgroundColor: color.ink,
                      opacity: 0.4,
                    }}
                  />
                ) : null}
                <View
                  style={{
                    width: '80%',
                    height: Math.max(2, ((w.points ?? 0) / maxPts) * 90),
                    borderRadius: 3,
                    backgroundColor: season.data!.best?.number === w.number ? color.active : '#B9C6FF',
                  }}
                />
                <Text style={{ fontSize: 9, color: color.muted, fontFamily: font.body }}>{w.number}</Text>
              </View>
            ))}
          </View>
          {season.data.weeks
            .filter((w) => w.points !== null)
            .slice(-3)
            .reverse()
            .map((w) => (
              <View
                key={w.gameweekId}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  minHeight: 32,
                  alignItems: 'center',
                }}
              >
                <Text style={{ fontFamily: font.bodySemi, color: color.ink }}>GW{w.number}</Text>
                <Small>
                  {w.landed} of {w.picked} actions landed
                </Small>
                <Text style={{ fontFamily: font.heading, color: color.ink }}>{w.points}</Text>
              </View>
            ))}
        </Card>
      ) : null}
    </Screen>
  );
}
