import { Text, View } from 'react-native';
import type { OwnedCard } from '../lib/types';
import { editionOf } from '../lib/types';
import { color, font } from '../lib/theme';
import { CardFace } from './CardFace';

/** "You give → you get" pair of small cards for a trade offer. */
export function TradePair({ give, get }: { give: OwnedCard | null; get: OwnedCard | null }) {
  const face = (c: OwnedCard | null, label: string) => (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <Text style={{ fontFamily: font.bodyBold, fontSize: 12, color: color.muted, letterSpacing: 1 }}>
        {label}
      </Text>
      {c ? (
        <CardFace
          name={c.player.name}
          position={c.player.position}
          clubCode={c.clubCode}
          rarity={c.card.rarity}
          rating={c.card.rating}
          level={c.card.level}
          edition={editionOf(c)}
          size="sm"
        />
      ) : (
        <Text style={{ color: color.muted }}>Card gone</Text>
      )}
    </View>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      {face(give, 'YOU GIVE')}
      <Text style={{ fontSize: 24, color: color.active }} accessibilityLabel="for">
        ⇄
      </Text>
      {face(get, 'YOU GET')}
    </View>
  );
}
