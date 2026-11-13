import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useApi } from '../../lib/useApi';
import type { OwnedCard, Pack } from '../../lib/types';
import { editionOf } from '../../lib/types';
import { color, font } from '../../lib/theme';
import { Button, Card, H1, H3, Loading, Screen, Small } from '../../components/ui';
import { CardFace } from '../../components/CardFace';

const PACK_NAME: Record<string, string> = {
  starter: 'Starter pack',
  player: 'Player pack',
  squad: 'Squad pack',
  swap: 'Swap pack',
  silver: 'Silver pack',
  gold: 'Gold pack',
  elite: 'Elite pack',
  totw: 'Team of the Week pack',
};

export default function Collection() {
  const cards = useApi<OwnedCard[]>('/cards');
  const packs = useApi<Pack[]>('/packs');
  const trades = useApi<{ incoming: unknown[] }>('/trades');
  if (!cards.data || !packs.data) return <Loading />;
  const sealed = packs.data.filter((p) => p.status === 'sealed');
  const editions = cards.data.filter((c) => editionOf(c));
  const incoming = trades.data?.incoming.length ?? 0;
  return (
    <Screen>
      <H1>Collection</H1>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button
          title="Coins & packs"
          variant="secondary"
          style={{ flex: 1 }}
          onPress={() => router.push('/rewards')}
        />
        <Button
          title={incoming ? `Trades (${incoming} new)` : 'Trades'}
          variant={incoming ? 'primary' : 'secondary'}
          style={{ flex: 1 }}
          onPress={() => router.push('/trades')}
        />
      </View>
      {sealed.length ? (
        <Card>
          <H3>Sealed packs</H3>
          {sealed.map((p) => (
            <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ flex: 1, fontFamily: font.bodySemi, color: color.ink }}>
                {PACK_NAME[p.type] ?? p.type}
                {p.rarity ? ` (${p.rarity})` : ''}
              </Text>
              <Button
                title="Open"
                onPress={() => router.push({ pathname: '/pack/[id]', params: { id: p.id } })}
              />
            </View>
          ))}
        </Card>
      ) : null}
      {editions.length ? (
        <Small>
          {editions.length} limited edition card{editions.length > 1 ? 's' : ''}: earned, numbered, never
          sold.
        </Small>
      ) : null}
      <H3>{cards.data.length} cards</H3>
      <Small>Tap a card for the player. Trade cards one-for-one with people in your mini-leagues.</Small>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {cards.data.map((c) => (
          <View key={c.card.id} style={{ opacity: c.card.active ? 1 : 0.5, gap: 4, alignItems: 'center' }}>
            <CardFace
              name={c.player.name}
              onPress={() => router.push({ pathname: '/player/[id]', params: { id: c.card.playerId } })}
              position={c.player.position}
              clubCode={c.clubCode}
              rarity={c.card.rarity}
              rating={c.card.rating}
              level={c.card.level}
              edition={editionOf(c)}
              size="sm"
            />
            {c.card.active ? (
              <Pressable
                onPress={() => router.push({ pathname: '/trade/new', params: { cardId: c.card.id } })}
                accessibilityRole="button"
                accessibilityLabel={`Trade ${c.player.name}`}
                style={{ minHeight: 36, justifyContent: 'center', paddingHorizontal: 8 }}
              >
                <Text style={{ fontFamily: font.bodySemi, color: color.active }}>Trade</Text>
              </Pressable>
            ) : (
              <Small>Inactive ({c.card.inactiveReason?.replace('_', ' ')})</Small>
            )}
          </View>
        ))}
      </View>
    </Screen>
  );
}
