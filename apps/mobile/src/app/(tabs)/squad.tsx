import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import type { SquadCard } from '../../lib/types';
import { color, font, type } from '../../lib/theme';
import { Button, Card, ErrorText, H1, H3, Loading, Screen, Small } from '../../components/ui';
import { Shirt } from '../../components/Shirt';

const SLOT_NAME = ['GK', 'DEF', 'MID', 'MID', 'FWD', 'SUB'];

interface OwnedCard {
  card: {
    id: string;
    rarity: SquadCard['rarity'];
    rating: number;
    level: number;
    active: boolean;
    inactiveReason: string | null;
  };
  player: { name: string; position: SquadCard['position'] };
  clubCode: string | null;
}

export default function Squad() {
  const squad = useApi<SquadCard[]>('/squad');
  const cards = useApi<OwnedCard[]>('/cards');
  const [slot, setSlot] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!squad.data || !cards.data) return <Loading />;
  const inSquad = new Set(squad.data.map((s) => s.cardId));
  const rating = squad.data.reduce((s, c) => s + c.rating, 0);
  const candidates =
    slot === null
      ? []
      : cards.data.filter(
          (c) =>
            !inSquad.has(c.card.id) && c.card.active && (slot === 5 || c.player.position === SLOT_NAME[slot]),
        );
  const place = async (cardId: string) => {
    try {
      await api('/squad/place', { body: { cardId, slot } });
      setSlot(null);
      setErr(null);
      await squad.reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Screen>
      <H1>Squad</H1>
      <Small>Squad rating {rating} · max 2 per club · changes apply from the next deadline</Small>
      {[0, 1, 2, 3, 4, 5].map((s) => {
        const c = squad.data!.find((x) => x.slot === s);
        return (
          <Pressable
            key={s}
            onPress={() => setSlot(slot === s ? null : s)}
            accessibilityRole="button"
            accessibilityLabel={`${SLOT_NAME[s]} slot${c ? `: ${c.name}` : ', empty'}`}
          >
            <Card
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                borderColor: slot === s ? color.active : color.border,
              }}
            >
              <Text
                style={{ width: 36, fontFamily: font.bodyBold, fontSize: type.caption, color: color.muted }}
              >
                {SLOT_NAME[s]}
              </Text>
              {c ? <Shirt label={c.position} rarity={c.rarity} size={36} /> : null}
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: font.bodySemi, color: color.ink }}>{c ? c.name : 'Empty'}</Text>
                {c ? (
                  <Small>
                    {c.clubCode} · {c.rarity} · {c.rating}
                    {c.level > 1 ? ` · Lv ${c.level}` : ''}
                  </Small>
                ) : null}
              </View>
              {c ? (
                <Pressable
                  onPress={() => router.push({ pathname: '/player/[id]', params: { id: c.playerId } })}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.name} profile`}
                  style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 }}
                >
                  <Text style={{ fontFamily: font.bodySemi, color: color.active }}>Profile</Text>
                </Pressable>
              ) : null}
              <Small>{slot === s ? 'Choose below' : 'Change'}</Small>
            </Card>
          </Pressable>
        );
      })}
      <ErrorText>{err}</ErrorText>
      {slot !== null ? (
        <View style={{ gap: 8 }}>
          <H3>Your {SLOT_NAME[slot]} cards</H3>
          {candidates.length === 0 ? (
            <Small>No other cards for this slot yet. Open packs from the Collection tab.</Small>
          ) : null}
          {candidates.map((c) => (
            <Card key={c.card.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Shirt label={c.player.position} rarity={c.card.rarity} size={32} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: font.bodySemi, color: color.ink }}>{c.player.name}</Text>
                <Small>
                  {c.clubCode} · {c.card.rarity} · {c.card.rating}
                </Small>
              </View>
              <Button title="Use" variant="secondary" onPress={() => place(c.card.id)} />
            </Card>
          ))}
        </View>
      ) : null}
      <Button title="Pick your actions" onPress={() => router.push('/picks')} />
    </Screen>
  );
}
