import { Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { Position, Rarity } from '@ff/shared';
import { useApi } from '../../lib/useApi';
import { shortDateTime } from '../../lib/format';
import { color, font, rarityColor, type } from '../../lib/theme';
import { Card, H1, H3, Loading, Screen, Small } from '../../components/ui';
import { Shirt } from '../../components/Shirt';

interface Profile {
  player: {
    id: string;
    name: string;
    position: Position;
    shirtNumber: number | null;
    club: { code: string; name: string } | null;
    status: string;
    rating: number;
    rarity: Rarity;
  };
  season: {
    appearances: number;
    minutes: number;
    goals: number;
    assists: number;
    cleanSheets: number;
    saves: number;
    penaltiesSaved: number;
    yellowCards: number;
    redCards: number;
  };
  recent: {
    gameweek: number;
    opponent: string;
    score: string | null;
    minutes: number;
    goals: number;
    assists: number;
    cleanSheet: boolean;
    saves: number;
    yellowCards: number;
  }[];
  actions: {
    id: string;
    label: string;
    tierLabel: string;
    points: number;
    last5: { hits: number; of: number };
    season: { hits: number; of: number };
  }[];
  upcoming: { gameweek: number; label: string; kickoffAt: string | null }[];
  myCards: { id: string; rarity: Rarity; rating: number; level: number; active: boolean }[];
}

const Stat = ({ label, value }: { label: string; value: string | number }) => (
  <View style={{ alignItems: 'center', minWidth: 64 }}>
    <Text style={{ fontFamily: font.heading, fontSize: type.h3, color: color.ink }}>{value}</Text>
    <Small>{label}</Small>
  </View>
);

/** Player profile. Names, numbers, positions and club codes only: no photos or crests in the test build. */
export default function PlayerProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const r = useApi<Profile>(`/players/${id}`);
  if (!r.data) return <Loading />;
  const { player: p, season: s } = r.data;
  const gk = p.position === 'GK';
  const def = p.position === 'DEF' || gk;
  return (
    <Screen>
      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Back"
        style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}
      >
        <Text style={{ fontSize: 22, color: color.ink }}>‹</Text>
      </Pressable>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <Shirt label={p.shirtNumber ? String(p.shirtNumber) : p.position} rarity={p.rarity} size={72} />
        <View style={{ flex: 1 }}>
          <H1>{p.name}</H1>
          <Small>
            {p.position} · {p.club ? p.club.name : 'Not at a league club'}
            {p.status !== 'active' ? ` · ${p.status.replace('_', ' ')}` : ''}
          </Small>
          <Text style={{ fontFamily: font.bodyBold, color: rarityColor(p.rarity) }}>
            {p.rarity.toUpperCase()} · rating {p.rating}
          </Text>
        </View>
      </View>

      <Card>
        <H3>This season</H3>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 }}>
          <Stat label="Apps" value={s.appearances} />
          <Stat label="Mins" value={s.minutes} />
          {gk ? <Stat label="Saves" value={s.saves} /> : <Stat label="Goals" value={s.goals} />}
          <Stat label="Assists" value={s.assists} />
          {def || p.position === 'MID' ? <Stat label="Clean sheets" value={s.cleanSheets} /> : null}
          <Stat label="Yellows" value={s.yellowCards} />
        </View>
        {s.appearances === 0 ? <Small>No minutes yet this season.</Small> : null}
      </Card>

      {r.data.upcoming.length ? (
        <Card>
          <H3>Next matches</H3>
          {r.data.upcoming.map((u) => (
            <View
              key={`${u.gameweek}-${u.label}`}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                minHeight: 28,
                alignItems: 'center',
              }}
            >
              <Text style={{ fontFamily: font.bodySemi, color: color.ink }}>
                GW{u.gameweek} {u.label}
              </Text>
              <Small>{u.kickoffAt ? shortDateTime(new Date(u.kickoffAt)) : 'TBC'}</Small>
            </View>
          ))}
        </Card>
      ) : null}

      <Card>
        <H3>Scoring actions</H3>
        <Small>How often each action would have landed for this player.</Small>
        {r.data.actions.map((a) => (
          <View
            key={a.id}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              minHeight: 40,
              borderTopWidth: 1,
              borderTopColor: color.divider,
              gap: 8,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: font.bodySemi, color: color.ink }}>{a.label}</Text>
              <Small>
                {a.tierLabel} · +{a.points} pts
              </Small>
            </View>
            <Small>{a.last5.of ? `${a.last5.hits}/${a.last5.of} last ${a.last5.of}` : '—'}</Small>
            <Small>{a.season.of ? `${a.season.hits}/${a.season.of} season` : ''}</Small>
          </View>
        ))}
      </Card>

      {r.data.recent.length ? (
        <Card>
          <H3>Recent matches</H3>
          {r.data.recent.map((m) => (
            <View
              key={`${m.gameweek}-${m.opponent}`}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                minHeight: 32,
                alignItems: 'center',
                borderTopWidth: 1,
                borderTopColor: color.divider,
              }}
            >
              <Text style={{ fontFamily: font.bodySemi, color: color.ink, width: 120 }}>
                GW{m.gameweek} {m.opponent}
              </Text>
              <Small>{m.score ?? ''}</Small>
              <Small>
                {m.minutes}′{m.goals ? ` · ${m.goals}G` : ''}
                {m.assists ? ` · ${m.assists}A` : ''}
                {m.cleanSheet ? ' · CS' : ''}
                {gk && m.saves ? ` · ${m.saves} sv` : ''}
                {m.yellowCards ? ' · YC' : ''}
              </Small>
            </View>
          ))}
        </Card>
      ) : null}

      {r.data.myCards.length ? (
        <Card>
          <H3>Your cards</H3>
          {r.data.myCards.map((c) => (
            <Small key={c.id} muted={false}>
              {c.rarity} · rating {c.rating} · level {c.level}
              {c.active ? '' : ' · inactive'}
            </Small>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
