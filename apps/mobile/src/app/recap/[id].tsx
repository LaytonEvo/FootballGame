import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { Position, Rarity } from '@ff/shared';
import { useApi } from '../../lib/useApi';
import { shareRecap } from '../../lib/share';
import { ordinal } from '../../lib/format';
import { color, font, type } from '../../lib/theme';
import { Button, Card, ErrorText, H3, Loading, Screen, Small } from '../../components/ui';
import { Pitch, PITCH_ROWS, PitchRow } from '../../components/Pitch';
import { PlayerSpot } from '../../components/PlayerSpot';

interface Recap {
  gameweek: { id: string; number: number; status: string; finalisedAt: string | null };
  points: number;
  provisional: boolean;
  actionsLanded: number;
  actionsPicked: number;
  five: {
    slot: number;
    name: string;
    position: Position;
    rarity: Rarity;
    shirtNumber: number | null;
    captain: boolean;
    role: string;
    points: number;
    landed: string;
  }[];
  best: { name: string; label: string; bold: boolean; points: number } | null;
  leagues: { leagueId: string; name: string; rank: number; previousRank: number | null; size: number }[];
  global: { rank: number; size: number; topPercent: number } | null;
  coinsEarned: number;
  packsUnlocked: { id: string; type: string; status: string }[];
}

export default function RecapScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const r = useApi<Recap>(`/recap/${id}`);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!r.data) return <Loading />;
  const d = r.data;
  const share = async (format: 'story' | 'square') => {
    setBusy(true);
    setErr(null);
    try {
      await shareRecap(d.gameweek.id, format);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const spot = (slot: number) => {
    const p = d.five.find((x) => x.slot === slot);
    if (!p) return <View key={slot} style={{ width: 112 }} />;
    return (
      <PlayerSpot
        key={slot}
        name={p.name}
        position={p.position}
        shirt={p.shirtNumber ? String(p.shirtNumber) : p.position}
        rarity={p.rarity}
        fixture={`${p.landed} landed`}
        captain={p.captain}
        bubble={String(p.points)}
        chips={[]}
      />
    );
  };
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
        <View>
          <Text style={{ fontFamily: font.heading, fontSize: type.h2, color: color.ink }}>
            GW{d.gameweek.number} recap
          </Text>
          <Small>{d.provisional ? 'Provisional until 09:00' : 'Final'}</Small>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
        <Text style={{ fontFamily: font.heading, fontSize: type.hero, color: color.active }}>{d.points}</Text>
        <Small>
          pts · {d.actionsLanded} of {d.actionsPicked} actions landed
        </Small>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {d.leagues.slice(0, 1).map((l) => (
          <Card key={l.leagueId} style={{ flex: 1 }}>
            <Small>{l.name}</Small>
            <H3>
              {ordinal(l.rank)}{' '}
              {l.previousRank && l.previousRank !== l.rank ? (
                <Text style={{ color: l.rank < l.previousRank ? color.active : color.missed.border }}>
                  {l.rank < l.previousRank ? `▲ ${l.previousRank - l.rank}` : `▼ ${l.rank - l.previousRank}`}
                </Text>
              ) : null}
            </H3>
          </Card>
        ))}
        {d.global ? (
          <Card style={{ flex: 1 }}>
            <Small>Global</Small>
            <H3>Top {d.global.topPercent}%</H3>
          </Card>
        ) : null}
        <Card style={{ flex: 1 }}>
          <Small>Coins</Small>
          <H3>+{d.coinsEarned}</H3>
        </Card>
      </View>
      <Pitch>
        {PITCH_ROWS.map((row, i) => (
          <PitchRow key={i}>{row.map(spot)}</PitchRow>
        ))}
      </Pitch>
      {d.best ? (
        <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Small>BEST ACTION</Small>
            <H3>
              {d.best.name} {d.best.label}
              {d.best.bold ? ' · bold' : ''}
            </H3>
          </View>
          <Text style={{ fontFamily: font.heading, fontSize: type.h2, color: color.landed.text }}>
            +{d.best.points}
          </Text>
        </Card>
      ) : null}
      {d.packsUnlocked.map((p) => (
        <Card key={p.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <H3 style={{ flex: 1 }}>{p.type[0]!.toUpperCase() + p.type.slice(1)} pack unlocked</H3>
          {p.status === 'sealed' ? (
            <Button
              title="Open"
              onPress={() => router.push({ pathname: '/pack/[id]', params: { id: p.id } })}
            />
          ) : null}
        </Card>
      ))}
      <Button
        title="Share my week"
        onPress={() => share('story')}
        loading={busy}
        accessibilityHint="Shares a 9:16 image with your invite code"
      />
      <Button
        title="Share square image"
        variant="secondary"
        onPress={() => share('square')}
        disabled={busy}
      />
      <ErrorText>{err}</ErrorText>
    </Screen>
  );
}
