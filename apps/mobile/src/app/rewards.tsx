import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';
import { color, font, radius, rarityColor, type } from '../lib/theme';
import { Body, Button, Card, ErrorText, H1, H3, Loading, Screen, Small } from '../components/ui';

interface Rewards {
  coins: number;
  seasonPoints: number;
  nextPack: { price: number; toGo: number };
  milestones: { season_points: number; reward: string; done: boolean }[];
  nextMilestone: { season_points: number; reward: string; toGo: number } | null;
  weeklyFreePack: { gameweek: number; unlocked: boolean; packId: string | null } | null;
  shop: { item: string; name: string; desc: string; price: number; odds: Record<string, number> | null }[];
  oddsVersion: string;
}

const REWARD_NAME: Record<string, string> = {
  silver_pack: 'Silver pack',
  gold_pack: 'Gold pack',
  elite_pack: 'Elite pack',
  player_pack: 'Player pack',
  squad_pack: 'Squad pack',
};
const REWARD_COLOUR: Record<string, string> = {
  silver_pack: rarityColor('silver'),
  gold_pack: rarityColor('gold'),
  elite_pack: rarityColor('elite'),
};
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const newKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export default function RewardsScreen() {
  const r = useApi<Rewards>('/rewards');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!r.data) return <Loading />;
  const d = r.data;
  const maxPts = Math.max(...d.milestones.map((m) => m.season_points), 1);
  const buy = async (item: string) => {
    if (item === 'card_swap') return router.push('/collection');
    setBusy(item);
    setErr(null);
    try {
      const res = await api<{ pack: { id: string } }>('/shop/buy', {
        body: { item },
        headers: { 'idempotency-key': newKey() },
      });
      router.push({ pathname: '/pack/[id]', params: { id: res.pack.id } });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
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
        <H1>Coins & packs</H1>
      </View>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Card style={{ flex: 1 }}>
          <Small>Coins</Small>
          <Text style={{ fontFamily: font.heading, fontSize: type.h1, color: color.ink }}>{d.coins}</Text>
          <Small>Spend on packs and swaps</Small>
        </Card>
        <Card style={{ flex: 1 }}>
          <Small>Season Points</Small>
          <Text style={{ fontFamily: font.heading, fontSize: type.h1, color: color.active }}>
            {d.seasonPoints}
          </Text>
          <Small>Decide the tables · never spent</Small>
        </Card>
      </View>
      <Card>
        <H3>
          {d.nextPack.toGo === 0 ? 'Player pack ready to buy' : `${d.nextPack.toGo} Coins to your next pack`}
        </H3>
        <View
          style={{ height: 8, borderRadius: 4, backgroundColor: color.track, overflow: 'hidden' }}
          accessibilityLabel={`${Math.min(d.coins, d.nextPack.price)} of ${d.nextPack.price} Coins`}
        >
          <View
            style={{
              width: `${Math.min(100, (d.coins / d.nextPack.price) * 100)}%`,
              height: 8,
              backgroundColor: color.active,
            }}
          />
        </View>
        <Small>1 Coin for every point you score, added when the gameweek is final at 09:00.</Small>
      </Card>
      <Card>
        <H3>Season milestones</H3>
        <Small>
          {d.nextMilestone
            ? `${d.nextMilestone.toGo} pts to ${REWARD_NAME[d.nextMilestone.reward]}`
            : 'All unlocked'}
        </Small>
        <View style={{ height: 8, borderRadius: 4, backgroundColor: color.track, marginTop: 8 }}>
          <View
            style={{
              width: `${Math.min(100, (d.seasonPoints / maxPts) * 100)}%`,
              height: 8,
              borderRadius: 4,
              backgroundColor: color.active,
            }}
          />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {d.milestones.map((m) => (
            <View
              key={m.season_points}
              style={{ alignItems: 'center' }}
              accessible
              accessibilityLabel={`${m.season_points} points: ${REWARD_NAME[m.reward]}${m.done ? ', unlocked' : ''}`}
            >
              <Text style={{ fontFamily: font.bodyBold, color: REWARD_COLOUR[m.reward] ?? color.ink }}>
                {m.done ? '✓ ' : ''}
                {m.season_points}
              </Text>
              <Small>{REWARD_NAME[m.reward]}</Small>
            </View>
          ))}
        </View>
      </Card>
      {d.weeklyFreePack ? (
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <H3>GW{d.weeklyFreePack.gameweek} free pack</H3>
            <Small>
              {d.weeklyFreePack.unlocked
                ? 'Unlocked. Open it any time.'
                : 'Confirm your actions to unlock it.'}
            </Small>
          </View>
          {d.weeklyFreePack.unlocked && d.weeklyFreePack.packId ? (
            <Button
              title="Open"
              onPress={() =>
                router.push({ pathname: '/pack/[id]', params: { id: d.weeklyFreePack!.packId! } })
              }
            />
          ) : (
            <Button title="Pick actions" variant="secondary" onPress={() => router.push('/picks')} />
          )}
        </Card>
      ) : null}
      <Card style={{ gap: 0, padding: 0 }}>
        {d.shop.map((s, i) => {
          const ok = d.coins >= s.price;
          return (
            <View
              key={s.item}
              style={{ padding: 14, gap: 4, borderTopWidth: i ? 1 : 0, borderTopColor: color.divider }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Body style={{ fontFamily: font.bodySemi }}>{s.name}</Body>
                  <Small>{s.desc}</Small>
                </View>
                <Pressable
                  onPress={() => buy(s.item)}
                  disabled={!ok || busy !== null}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !ok }}
                  style={{
                    minHeight: 44,
                    minWidth: 96,
                    paddingHorizontal: 12,
                    borderRadius: radius.button,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: ok ? color.active : color.background,
                    borderWidth: ok ? 0 : 1,
                    borderColor: color.border,
                  }}
                >
                  <Text style={{ fontFamily: font.bodyBold, color: ok ? '#fff' : color.muted }}>
                    {ok ? `${s.price} Coins` : `${s.price - d.coins} to go`}
                  </Text>
                </Pressable>
              </View>
              {s.odds ? (
                <Small>
                  Odds v{d.oddsVersion}:{' '}
                  {Object.entries(s.odds)
                    .map(([k, v]) => `${k} ${pct(v)}`)
                    .join(' · ')}
                </Small>
              ) : (
                <Small>Pick the card in your collection, then choose Swap.</Small>
              )}
            </View>
          );
        })}
      </Card>
      <ErrorText>{err}</ErrorText>
      <Small>
        Coins are earned in the game only. They cannot be bought or cashed out and have no value outside the
        game.
      </Small>
    </Screen>
  );
}
