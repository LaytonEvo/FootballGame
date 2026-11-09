import { Text, View } from 'react-native';
import type { Position, Rarity } from '@ff/shared';
import { color, font, radius, rarityColor, type } from '../lib/theme';
import { plateName } from '../lib/format';
import { Shirt } from './Shirt';

export function CardFace({
  name,
  position,
  clubCode,
  rarity,
  rating,
  size = 'lg',
  level,
}: {
  name: string;
  position: Position;
  clubCode: string | null;
  rarity: Rarity;
  rating: number;
  size?: 'lg' | 'sm';
  level?: number;
}) {
  const lg = size === 'lg';
  return (
    <View
      accessible
      accessibilityLabel={`${name}, ${position}, ${clubCode ?? 'no club'}, ${rarity} card, rating ${rating}`}
      style={{
        width: lg ? 230 : 104,
        padding: lg ? 16 : 8,
        borderRadius: radius.card,
        backgroundColor: color.surface,
        borderWidth: 3,
        borderColor: rarityColor(rarity),
        alignItems: 'center',
        gap: lg ? 8 : 4,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'stretch' }}>
        <Text
          style={{
            fontFamily: font.bodyBold,
            fontSize: type.caption,
            color: rarityColor(rarity),
            letterSpacing: 1,
          }}
        >
          {rarity.toUpperCase()}
        </Text>
        <Text style={{ fontFamily: font.heading, fontSize: lg ? type.h3 : type.small, color: color.ink }}>
          {rating}
        </Text>
      </View>
      <Shirt label={position} rarity={rarity} size={lg ? 130 : 52} />
      <Text
        numberOfLines={1}
        style={{ fontFamily: font.heading, fontSize: lg ? type.h2 : type.small, color: color.ink }}
      >
        {lg ? name : plateName(name)}
      </Text>
      <Text
        style={{ fontFamily: font.bodyMedium, fontSize: lg ? type.small : type.caption, color: color.muted }}
      >
        {position} · {clubCode ?? '—'}
        {level && level > 1 ? ` · Lv ${level}` : ''}
      </Text>
    </View>
  );
}
