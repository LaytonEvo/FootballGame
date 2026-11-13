import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import type { OwnedCard } from '../../lib/types';
import { editionOf } from '../../lib/types';
import { color, font, radius } from '../../lib/theme';
import { Body, Button, Card, ErrorText, H1, H3, Loading, Screen, Small } from '../../components/ui';
import { CardFace } from '../../components/CardFace';
import { TradePair } from '../../components/TradeCard';

/** Offer one of your cards for one of a league-mate’s cards. */
export default function NewTrade() {
  const { cardId } = useLocalSearchParams<{ cardId: string }>();
  const mine = useApi<OwnedCard[]>('/cards');
  const partners = useApi<{ id: string; name: string }[]>('/trades/partners');
  const [partner, setPartner] = useState<{ id: string; name: string } | null>(null);
  const theirs = useApi<OwnedCard[]>(partner ? `/trades/partners/${partner.id}/cards` : null);
  const [want, setWant] = useState<OwnedCard | null>(null);
  const [err, setErr] = useState<string | null>(theirs.error?.message ?? null);
  const [busy, setBusy] = useState(false);
  const give = mine.data?.find((c) => c.card.id === cardId) ?? null;
  if (!mine.data || !partners.data) return <Loading />;

  const send = async () => {
    if (!give || !want || !partner) return;
    setBusy(true);
    setErr(null);
    try {
      await api('/trades', {
        body: { offeredCardId: give.card.id, toUserId: partner.id, requestedCardId: want.card.id },
      });
      router.replace('/trades');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
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
        <H1>Offer a trade</H1>
      </View>
      {give ? (
        <TradePair give={give} get={want} emptyLabel="Pick a card" />
      ) : (
        <Small>That card isn’t in your collection.</Small>
      )}

      <H3>1 · Who with?</H3>
      {partners.data.length === 0 ? (
        <Card>
          <Body>You can trade with people in your mini-leagues. Create or join one first.</Body>
          <Button title="Go to Leagues" variant="secondary" onPress={() => router.push('/leagues')} />
        </Card>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {partners.data.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => {
                setPartner(p);
                setWant(null);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: partner?.id === p.id }}
              style={{
                minHeight: 44,
                paddingHorizontal: 14,
                justifyContent: 'center',
                borderRadius: radius.pill,
                borderWidth: 2,
                borderColor: partner?.id === p.id ? color.active : color.border,
                backgroundColor: color.surface,
              }}
            >
              <Text style={{ fontFamily: font.bodySemi, color: color.ink }}>{p.name}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {partner ? (
        <>
          <H3>2 · Which of {partner.name}’s cards?</H3>
          {!theirs.data ? <Loading /> : null}
          {theirs.data && theirs.data.length === 0 ? (
            <Small>{partner.name} has no cards to trade yet. Try another league-mate.</Small>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {(theirs.data ?? []).map((c) => (
              <View
                key={c.card.id}
                style={{
                  borderRadius: radius.card + 4,
                  borderWidth: 3,
                  borderColor: want?.card.id === c.card.id ? color.active : 'transparent',
                }}
              >
                <CardFace
                  name={c.player.name}
                  position={c.player.position}
                  clubCode={c.clubCode}
                  rarity={c.card.rarity}
                  rating={c.card.rating}
                  level={c.card.level}
                  edition={editionOf(c)}
                  size="sm"
                  onPress={() => setWant(c)}
                />
              </View>
            ))}
          </View>
        </>
      ) : null}
      <ErrorText>{err ?? theirs.error?.message ?? null}</ErrorText>
      <Button
        title={want ? `Offer ${give?.player.name ?? ''} for ${want.player.name}` : 'Choose a card'}
        disabled={!want || !give}
        loading={busy}
        onPress={send}
      />
      <Small>
        They have 48 hours to accept. A traded card leaves your five; your squad fills the gap from your
        collection.
      </Small>
    </Screen>
  );
}
