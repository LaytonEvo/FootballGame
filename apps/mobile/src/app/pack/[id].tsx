import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '../../lib/api';
import { pendingInvite } from '../../lib/invite';
import { useApi } from '../../lib/useApi';
import type { PackStage } from '../../lib/motion';
import { PACK_MOTION, packTimeline } from '../../lib/motion';
import type { Pack, PackCard } from '../../lib/types';
import { color, font, rarityColor, type } from '../../lib/theme';
import { Button, ErrorText, Screen, Small } from '../../components/ui';
import { Gradient } from '../../components/Gradient';
import { CardFace } from '../../components/CardFace';

const TITLE: Record<string, string> = {
  starter: 'Starter pack',
  player: 'Player pack',
  squad: 'Squad pack',
  swap: 'Swap pack',
  silver: 'Silver pack',
  gold: 'Gold pack',
  elite: 'Elite pack',
};
const SLOT_FOR: Record<string, number[]> = { GK: [0], DEF: [1], MID: [2, 3], FWD: [4] };

export default function PackScreen() {
  const { id, onboarding } = useLocalSearchParams<{ id: string; onboarding?: string }>();
  const packs = useApi<Pack[]>('/packs');
  const pack = packs.data?.find((p) => p.id === id);
  const [stage, setStage] = useState<PackStage>('sealed');
  const [cards, setCards] = useState<PackCard[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reduce, setReduce] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const rot = useSharedValue(0);
  const flip = useSharedValue(180);
  const fade = useSharedValue(0);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduce);
    return () => timers.current.forEach(clearTimeout);
  }, []);

  const open = async () => {
    if (stage !== 'sealed') return;
    try {
      const res = await api<{ cards: PackCard[] }>(`/packs/${id}/open`, { method: 'POST' });
      setCards(res.cards);
    } catch (e) {
      setErr((e as Error).message);
      return;
    }
    for (const { stage: s, at } of packTimeline(reduce))
      timers.current.push(setTimeout(() => setStage(s), at));
    if (reduce) {
      fade.value = withTiming(1, { duration: PACK_MOTION.fadeMs });
      flip.value = 0;
      return;
    }
    rot.value = withSequence(
      ...[-5, 5, -4, 4, -2, 0].map((d) => withTiming(d, { duration: PACK_MOTION.shakeMs / 6 })),
    );
    flip.value = withSequence(
      withTiming(180, { duration: PACK_MOTION.shakeMs + PACK_MOTION.tearMs }),
      withTiming(0, { duration: PACK_MOTION.flipMs, easing: Easing.out(Easing.cubic) }),
    );
    fade.value = withSequence(
      withTiming(0, { duration: PACK_MOTION.shakeMs + PACK_MOTION.tearMs + PACK_MOTION.flipMs }),
      withTiming(1, { duration: PACK_MOTION.fadeMs }),
    );
  };
  const skip = () => {
    timers.current.forEach(clearTimeout);
    setStage('revealed');
    rot.value = 0;
    flip.value = 0;
    fade.value = 1;
  };

  const packStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }] }));
  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 800 }, { rotateY: `${flip.value}deg` }],
  }));
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  const place = async (card: PackCard, slot: number) => {
    try {
      await api('/squad/place', { body: { cardId: card.cardId, slot } });
      router.replace('/squad');
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const swap = async (card: PackCard) => {
    try {
      const r = await api<{ packId: string }>(`/cards/${card.cardId}/swap`, { method: 'POST' });
      router.replace({ pathname: '/pack/[id]', params: { id: r.packId } });
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  // Invite opened before sign-up: land in that league after the starter pack.
  const afterOnboardingPack = async () => {
    const code = await pendingInvite.get();
    if (code) {
      try {
        const l = await api<{ id: string }>('/leagues/join', { body: { code } });
        await pendingInvite.set(null);
        router.replace({ pathname: '/league/[id]', params: { id: l.id, fromInvite: '1' } });
        return;
      } catch {
        await pendingInvite.set(null);
      }
    }
    router.replace({ pathname: '/picks', params: { guided: '1' } });
  };

  const opened = stage !== 'sealed' && stage !== 'shake';
  const single = cards?.length === 1 ? cards[0]! : null;
  const glow = single ? rarityColor(single.rarity) : color.accent;
  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontFamily: font.heading, fontSize: type.h2, color: color.ink }}>
          {TITLE[pack?.type ?? 'player']}
        </Text>
        {stage !== 'sealed' && stage !== 'revealed' ? (
          <Pressable
            onPress={skip}
            accessibilityRole="button"
            style={{ minHeight: 44, minWidth: 64, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ fontFamily: font.bodyBold, color: color.active }}>Skip</Text>
          </Pressable>
        ) : null}
      </View>
      {pack ? (
        <Small>
          Odds (v{pack.oddsVersion}):{' '}
          {Object.entries(pack.odds)
            .map(([r, p]) => `${r} ${Math.round((p ?? 0) * 1000) / 10}%`)
            .join(' · ')}
        </Small>
      ) : null}
      <View style={{ alignItems: 'center', justifyContent: 'center', minHeight: 360 }}>
        {!opened ? (
          <Animated.View style={packStyle}>
            <Pressable
              onPress={open}
              accessibilityRole="button"
              accessibilityLabel={`Open ${TITLE[pack?.type ?? 'player']}`}
              disabled={!pack || pack.status === 'opened'}
            >
              <Gradient
                radius={20}
                style={{ width: 220, height: 300, alignItems: 'center', justifyContent: 'center', gap: 8 }}
              >
                <Text style={{ fontFamily: font.heading, fontSize: 64, color: '#fff' }}>?</Text>
                <Text
                  style={{ fontFamily: font.heading, fontSize: type.h3, color: '#fff', letterSpacing: 1 }}
                >
                  {TITLE[pack?.type ?? 'player']?.toUpperCase()}
                </Text>
              </Gradient>
            </Pressable>
          </Animated.View>
        ) : (
          <>
            {stage === 'burst' ? (
              <View
                style={{
                  position: 'absolute',
                  width: 300,
                  height: 300,
                  borderRadius: 150,
                  backgroundColor: glow,
                  opacity: 0.35,
                }}
              />
            ) : null}
            <Animated.View
              style={[
                cardStyle,
                { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
              ]}
            >
              {(cards ?? []).map((c) => (
                <CardFace key={c.cardId} {...c} size={single ? 'lg' : 'sm'} />
              ))}
            </Animated.View>
          </>
        )}
        {stage === 'sealed' ? <Small style={{ marginTop: 12 }}>Tap the pack to open</Small> : null}
      </View>
      <ErrorText>{err}</ErrorText>
      {stage === 'revealed' && cards ? (
        <Animated.View style={[fadeStyle, { gap: 8 }]}>
          {single ? (
            <Text
              style={{ textAlign: 'center', fontFamily: font.bodyBold, color: rarityColor(single.rarity) }}
            >
              {single.rarity.toUpperCase()} ·{' '}
              {single.duplicate ? `DUPLICATE · LEVEL ${single.level}` : 'NEW CARD'}
            </Text>
          ) : null}
          {onboarding ? (
            <Button title="Pick your actions" onPress={afterOnboardingPack} />
          ) : single && !single.duplicate ? (
            <>
              {(SLOT_FOR[single.position] ?? []).concat(5).map((slot) => (
                <Button
                  key={slot}
                  title={
                    slot === 5
                      ? 'Put on the bench (sub)'
                      : `Put in my five${SLOT_FOR[single.position]!.length > 1 ? ` (${single.position} ${slot - 1})` : ''}`
                  }
                  onPress={() => place(single, slot)}
                />
              ))}
              <Button title="Keep in collection" variant="secondary" onPress={() => router.back()} />
              <Button title="Swap for a pack" variant="ghost" onPress={() => swap(single)} />
            </>
          ) : (
            <Button title="Done" onPress={() => router.replace('/squad')} />
          )}
        </Animated.View>
      ) : null}
    </Screen>
  );
}
