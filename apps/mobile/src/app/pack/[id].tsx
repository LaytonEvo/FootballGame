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
import { PACK_MOTION, revealOrder } from '../../lib/motion';
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

/**
 * sealed → (tap) shake 0.6 s → tear + rarity glow 0.4 s → card 1 flips (0.6 s) and its name fades in (0.3 s)
 * → tap for the next card, one player at a time → summary. Skip is always visible and jumps to the summary.
 * Reduce Motion: every step is a fade. No near-miss effects; every card gets the same timing.
 */
type Phase = 'sealed' | 'opening' | 'card' | 'summary';

export default function PackScreen() {
  const { id, onboarding } = useLocalSearchParams<{ id: string; onboarding?: string }>();
  const packs = useApi<Pack[]>('/packs');
  const pack = packs.data?.find((p) => p.id === id);
  const [phase, setPhase] = useState<Phase>('sealed');
  const [cards, setCards] = useState<PackCard[]>([]);
  const [index, setIndex] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [reduce, setReduce] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const rot = useSharedValue(0);
  const flip = useSharedValue(180);
  const fade = useSharedValue(0);
  const glow = useSharedValue(0);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduce);
    return () => timers.current.forEach(clearTimeout);
  }, []);

  const later = (ms: number, f: () => void) => timers.current.push(setTimeout(f, ms));

  /** Flip in one card: glow, 0.6 s flip, 0.3 s fade-in of name and buttons. */
  const revealCard = (i: number) => {
    setIndex(i);
    setPhase('card');
    if (reduce) {
      flip.value = 0;
      glow.value = 0.3;
      fade.value = 0;
      fade.value = withTiming(1, { duration: PACK_MOTION.fadeMs });
      return;
    }
    flip.value = 180;
    fade.value = 0;
    glow.value = withSequence(
      withTiming(0.85, { duration: PACK_MOTION.tearMs }),
      withTiming(0.35, { duration: PACK_MOTION.flipMs }),
    );
    flip.value = withTiming(0, { duration: PACK_MOTION.flipMs, easing: Easing.out(Easing.cubic) });
    fade.value = withSequence(
      withTiming(0, { duration: PACK_MOTION.flipMs }),
      withTiming(1, { duration: PACK_MOTION.fadeMs }),
    );
  };

  const open = async () => {
    if (phase !== 'sealed') return;
    let got: PackCard[];
    try {
      got = revealOrder((await api<{ cards: PackCard[] }>(`/packs/${id}/open`, { method: 'POST' })).cards);
    } catch (e) {
      setErr((e as Error).message);
      return;
    }
    setCards(got);
    setPhase('opening');
    if (reduce) return revealCard(0);
    rot.value = withSequence(
      ...[-5, 5, -4, 4, -2, 0].map((d) => withTiming(d, { duration: PACK_MOTION.shakeMs / 6 })),
    );
    later(PACK_MOTION.shakeMs, () => {
      glow.value = withTiming(0.85, { duration: PACK_MOTION.tearMs });
    });
    later(PACK_MOTION.shakeMs + PACK_MOTION.tearMs, () => revealCard(0));
  };
  const next = () => (index + 1 < cards.length ? revealCard(index + 1) : setPhase('summary'));
  const skip = () => {
    timers.current.forEach(clearTimeout);
    rot.value = 0;
    flip.value = 0;
    fade.value = 1;
    setPhase('summary');
  };

  const packStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }] }));
  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 800 }, { rotateY: `${flip.value}deg` }],
  }));
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

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
  const profile = (c: PackCard) => router.push({ pathname: '/player/[id]', params: { id: c.playerId } });

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

  const current = cards[index];
  const single = cards.length === 1 ? cards[0]! : null;
  const many = cards.length > 1;
  const title = TITLE[pack?.type ?? 'player'];
  const label = (c: PackCard) =>
    `${c.rarity.toUpperCase()} · ${c.duplicate ? `DUPLICATE · LEVEL ${c.level}` : 'NEW CARD'}`;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontFamily: font.heading, fontSize: type.h2, color: color.ink }}>{title}</Text>
        {phase === 'opening' || (phase === 'card' && many) ? (
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

      {phase === 'sealed' || phase === 'opening' ? (
        <View style={{ alignItems: 'center', justifyContent: 'center', minHeight: 380 }}>
          <Animated.View
            style={[
              glowStyle,
              {
                position: 'absolute',
                width: 320,
                height: 320,
                borderRadius: 160,
                backgroundColor: color.accent,
              },
            ]}
          />
          <Animated.View style={packStyle}>
            <Pressable
              onPress={open}
              accessibilityRole="button"
              accessibilityLabel={`Open ${title}`}
              disabled={!pack || pack.status === 'opened' || phase !== 'sealed'}
            >
              <Gradient
                radius={20}
                style={{ width: 220, height: 300, alignItems: 'center', justifyContent: 'center', gap: 8 }}
              >
                <Text style={{ fontFamily: font.heading, fontSize: 64, color: '#fff' }}>?</Text>
                <Text
                  style={{ fontFamily: font.heading, fontSize: type.h3, color: '#fff', letterSpacing: 1 }}
                >
                  {title?.toUpperCase()}
                </Text>
              </Gradient>
            </Pressable>
          </Animated.View>
          {phase === 'sealed' ? <Small style={{ marginTop: 12 }}>Tap the pack to open</Small> : null}
        </View>
      ) : null}

      {phase === 'card' && current ? (
        <Pressable
          onPress={many ? next : undefined}
          accessibilityRole={many ? 'button' : undefined}
          accessibilityLabel={many ? 'Next card' : undefined}
          style={{ alignItems: 'center', gap: 12 }}
        >
          {many ? (
            <Small>
              Card {index + 1} of {cards.length}
            </Small>
          ) : null}
          <View style={{ alignItems: 'center', justifyContent: 'center', minHeight: 360 }}>
            <Animated.View
              style={[
                glowStyle,
                {
                  position: 'absolute',
                  width: 320,
                  height: 320,
                  borderRadius: 160,
                  backgroundColor: rarityColor(current.rarity),
                },
              ]}
            />
            <Animated.View style={cardStyle} key={current.cardId}>
              <CardFace {...current} size="lg" />
            </Animated.View>
          </View>
          <Animated.View style={[fadeStyle, { alignItems: 'center', gap: 4 }]}>
            <Text style={{ fontFamily: font.bodyBold, color: rarityColor(current.rarity) }}>
              {label(current)}
            </Text>
            {many ? (
              <Small>{index + 1 < cards.length ? 'Tap for the next player' : 'Tap to see your pack'}</Small>
            ) : null}
          </Animated.View>
        </Pressable>
      ) : null}

      <ErrorText>{err}</ErrorText>

      {/* Single-card pack: decide right after the reveal. */}
      {single && (phase === 'card' || phase === 'summary') ? (
        <Animated.View style={[phase === 'card' ? fadeStyle : null, { gap: 8 }]}>
          {phase === 'summary' ? (
            <View style={{ alignItems: 'center' }}>
              <CardFace {...single} size="lg" onPress={() => profile(single)} />
            </View>
          ) : null}
          <Button title="View player" variant="ghost" onPress={() => profile(single)} />
          {onboarding ? (
            <Button title="Pick your actions" onPress={afterOnboardingPack} />
          ) : !single.duplicate ? (
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

      {/* Multi-card pack: everything you got, tap a card for the player profile. */}
      {many && phase === 'summary' ? (
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
            {cards.map((c) => (
              <CardFace key={c.cardId} {...c} size="sm" onPress={() => profile(c)} />
            ))}
          </View>
          <Small style={{ textAlign: 'center' }}>Tap a card to see the player.</Small>
          {onboarding ? (
            <Button title="Pick your actions" onPress={afterOnboardingPack} />
          ) : (
            <Button title="Done" onPress={() => router.replace('/squad')} />
          )}
        </View>
      ) : null}
    </Screen>
  );
}
