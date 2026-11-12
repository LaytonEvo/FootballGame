import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { useApi } from '../../lib/useApi';
import type { Pack } from '../../lib/types';
import { color, font } from '../../lib/theme';
import { Button, Card, H1, H3, Loading, Screen, Small } from '../../components/ui';
import { CardFace } from '../../components/CardFace';

interface OwnedCard {
  card: {
    id: string;
    playerId: string;
    rarity: 'bronze' | 'silver' | 'gold' | 'elite';
    rating: number;
    level: number;
    active: boolean;
    inactiveReason: string | null;
  };
  player: { name: string; position: 'GK' | 'DEF' | 'MID' | 'FWD' };
  clubCode: string | null;
}

export default function Collection() {
  const cards = useApi<OwnedCard[]>('/cards');
  const packs = useApi<Pack[]>('/packs');
  if (!cards.data || !packs.data) return <Loading />;
  const sealed = packs.data.filter((p) => p.status === 'sealed');
  return (
    <Screen>
      <H1>Collection</H1>
      <Button title="Coins & packs" variant="secondary" onPress={() => router.push('/rewards')} />
      {sealed.length ? (
        <Card>
          <H3>Sealed packs</H3>
          {sealed.map((p) => (
            <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ flex: 1, fontFamily: font.bodySemi, color: color.ink }}>
                {p.type} pack{p.rarity ? ` (${p.rarity})` : ''}
              </Text>
              <Button
                title="Open"
                onPress={() => router.push({ pathname: '/pack/[id]', params: { id: p.id } })}
              />
            </View>
          ))}
        </Card>
      ) : null}
      <H3>{cards.data.length} cards</H3>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {cards.data.map((c) => (
          <View key={c.card.id} style={{ opacity: c.card.active ? 1 : 0.5 }}>
            <CardFace
              name={c.player.name}
              onPress={() => router.push({ pathname: '/player/[id]', params: { id: c.card.playerId } })}
              position={c.player.position}
              clubCode={c.clubCode}
              rarity={c.card.rarity}
              rating={c.card.rating}
              level={c.card.level}
              size="sm"
            />
            {!c.card.active ? <Small>Inactive ({c.card.inactiveReason?.replace('_', ' ')})</Small> : null}
          </View>
        ))}
      </View>
    </Screen>
  );
}
