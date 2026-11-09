import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useApi } from '../../lib/useApi';
import type { HomeData } from '../../lib/home';
import { countdown, ordinal, plateName, shortDateTime } from '../../lib/format';
import { color, font, radius, type } from '../../lib/theme';
import { Body, Button, Card, H3, Loading, Screen, Small } from '../../components/ui';
import { Gradient } from '../../components/Gradient';
import { Shirt } from '../../components/Shirt';
import { LiveView } from '../../components/LiveView';

function useServerNow(serverTime?: string) {
  const [offset, setOffset] = useState(0);
  const [, force] = useState(0);
  useEffect(() => {
    if (serverTime) setOffset(new Date(serverTime).getTime() - Date.now());
  }, [serverTime]);
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return new Date(Date.now() + offset);
}

export default function Home() {
  const home = useApi<HomeData>('/home', { pollMs: 30_000 });
  const now = useServerNow(home.data?.serverTime);
  if (!home.data) return <Loading />;
  const h = home.data;
  const gw = h.gameweek;
  const coins = h.coins;
  const next = h.next;
  const live = h.mode === 'live' || h.mode === 'locked';
  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontFamily: font.heading, fontSize: type.h1, color: color.ink }}>
          {gw ? `Gameweek ${gw.number}` : 'Fantasy Five'}
        </Text>
        {coins ? (
          <Pressable
            onPress={() => router.push('/rewards')}
            accessibilityRole="button"
            accessibilityLabel={`${coins.balance} Coins, ${coins.toNextPack} to next pack`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor: color.surface,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: color.border,
              paddingHorizontal: 10,
              minHeight: 36,
            }}
          >
            <Text style={{ fontFamily: font.bodyBold, color: color.ink }}>{coins.balance} Coins</Text>
            <View
              style={{
                width: 36,
                height: 5,
                borderRadius: 3,
                backgroundColor: color.track,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  width: `${Math.min(100, ((coins.nextPackPrice - coins.toNextPack) / coins.nextPackPrice) * 100)}%`,
                  height: 5,
                  backgroundColor: color.active,
                }}
              />
            </View>
            <Small>{coins.toNextPack} to pack</Small>
          </Pressable>
        ) : null}
      </View>

      {h.mode === 'live' || h.mode === 'locked' ? <LiveView home={h} /> : null}

      {next ? (
        <>
          <Gradient radius={radius.card} style={{ padding: 18, gap: 4 }}>
            <Text style={{ fontFamily: font.bodySemi, color: '#fff' }}>GW{next.number} actions lock in</Text>
            <Text
              style={{ fontFamily: font.heading, fontSize: live ? type.h1 : type.hero, color: '#fff' }}
              accessibilityLiveRegion="polite"
            >
              {countdown(new Date(next.deadlineAt), now)}
            </Text>
            <Text style={{ fontFamily: font.body, color: '#fff' }}>
              {shortDateTime(new Date(next.deadlineAt))} · first kick-off{' '}
              {shortDateTime(new Date(next.firstKickoffAt)).split(' ')[1]}
            </Text>
          </Gradient>
          {!live ? (
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <H3>Your five</H3>
                <Small>{h.picks.confirmed ? 'Confirmed' : `${h.picks.setCount} of 5 set`}</Small>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                {h.squad
                  .filter((p) => p.slot < 5)
                  .map((p) => (
                    <View key={p.slot} style={{ alignItems: 'center', width: 60 }}>
                      <Shirt
                        label={p.shirtNumber ? String(p.shirtNumber) : p.position}
                        rarity={p.rarity}
                        size={44}
                      />
                      <Text
                        numberOfLines={1}
                        style={{ fontFamily: font.bodySemi, fontSize: type.caption, color: color.ink }}
                      >
                        {plateName(p.name)}
                      </Text>
                      <Text style={{ fontFamily: font.body, fontSize: type.caption, color: color.muted }}>
                        {p.position}
                      </Text>
                    </View>
                  ))}
              </View>
            </Card>
          ) : null}
          {h.squad.length >= 5 ? (
            <Button
              title={
                h.picks.confirmed
                  ? `Edit your GW${next.number} actions`
                  : `Pick your GW${next.number} actions`
              }
              onPress={() => router.push('/picks')}
            />
          ) : null}
        </>
      ) : !live ? (
        <Card>
          <Body>
            {h.mode === 'off_season' ? 'The season has not started yet.' : 'No upcoming gameweek right now.'}
          </Body>
        </Card>
      ) : null}

      {h.league ? (
        <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Small>{h.league.name}</Small>
            <H3>
              {ordinal(h.league.rank)} of {h.league.size}
            </H3>
            <Small>
              {h.league.points} pts
              {h.league.gapAbove ? ` · ${h.league.gapAbove} behind ${ordinal(h.league.rank - 1)}` : ''}
            </Small>
          </View>
          <Button
            title="Table"
            variant="secondary"
            onPress={() => router.push({ pathname: '/league/[id]', params: { id: h.league!.id } })}
          />
        </Card>
      ) : h.league === null ? (
        <Card>
          <H3>Play with friends</H3>
          <Small>Start a mini-league and share the link. Everyone gets their own five.</Small>
          <Button title="Create a mini-league" variant="secondary" onPress={() => router.push('/leagues')} />
        </Card>
      ) : null}

      {h.sealedPacks.length ? (
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              backgroundColor: '#FFF4D6',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontFamily: font.heading, color: '#8A6508' }}>+</Text>
          </View>
          <View style={{ flex: 1 }}>
            <H3>
              {h.sealedPacks.length} pack{h.sealedPacks.length > 1 ? 's' : ''} ready
            </H3>
            <Small>{sourceLabel(h.sealedPacks[0]!.source)}</Small>
          </View>
          <Button
            title="Open"
            onPress={() => router.push({ pathname: '/pack/[id]', params: { id: h.sealedPacks[0]!.id } })}
          />
        </Card>
      ) : null}

      {h.lastRecap ? (
        <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Body style={{ flex: 1 }}>
            GW{h.lastRecap.number} · {h.lastRecap.points} pts · {h.lastRecap.landed} of {h.lastRecap.picked}{' '}
            actions landed
          </Body>
          <Button
            title="Recap"
            variant="ghost"
            onPress={() => router.push({ pathname: '/recap/[id]', params: { id: h.lastRecap!.gameweekId } })}
          />
        </Card>
      ) : null}
    </Screen>
  );
}

const sourceLabel = (s: string) =>
  ({
    weekly_free: 'Weekly free pack',
    milestone: 'Season milestone',
    compensation: 'Free swap pack (card left the league)',
    coins: 'Bought with Coins',
    signup: 'Starter pack',
    swap: 'Card swap',
  })[s] ?? s;
