import { Pressable, Text, View } from 'react-native';
import type { Position, Rarity } from '@ff/shared';
import { color, font, radius, rarityColor, type } from '../lib/theme';
import { Shirt } from './Shirt';
import { Gradient } from './Gradient';
import type { CardEdition } from '../lib/types';

/** "Benoît Badiashile Mukinayi" → "Badiashile Mukinayi" (small cards); full name on large ones. */
const cardName = (full: string) => {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : full;
};

export function CardFace({
  name,
  position,
  clubCode,
  rarity,
  rating,
  size = 'lg',
  level,
  onPress,
  edition,
}: {
  name: string;
  position: Position;
  clubCode: string | null;
  rarity: Rarity;
  rating: number;
  size?: 'lg' | 'sm';
  level?: number;
  onPress?: () => void;
  /** Limited edition: gradient frame and its number, e.g. Team of the Week · GW11 · #12/50. */
  edition?: CardEdition | null;
}) {
  const lg = size === 'lg';
  const body = (
    <View
      style={{
        width: lg ? 230 : 120,
        minHeight: lg ? undefined : 150,
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
      {/* Names wrap onto two lines rather than being cut off. */}
      <Text
        numberOfLines={2}
        style={{
          textAlign: 'center',
          fontFamily: font.heading,
          fontSize: lg ? type.h2 : 13,
          lineHeight: lg ? 28 : 16,
          color: color.ink,
        }}
      >
        {lg ? name : cardName(name)}
      </Text>
      <Text
        style={{ fontFamily: font.bodyMedium, fontSize: lg ? type.small : type.caption, color: color.muted }}
      >
        {position} · {clubCode ?? '—'}
        {level && level > 1 ? ` · Lv ${level}` : ''}
      </Text>
    </View>
  );
  const framed = edition ? (
    <Gradient radius={radius.card + 3} style={{ padding: 4 }}>
      {body}
      <Text
        style={{
          textAlign: 'center',
          color: '#FBFCFF',
          fontFamily: font.bodyBold,
          fontSize: lg ? 18 : 11,
          paddingTop: 3,
          maxWidth: lg ? 230 : 120,
        }}
      >
        {edition.name.replace('Team of the Week', 'TOTW')} · #{edition.serial}/{edition.supply}
      </Text>
    </Gradient>
  ) : (
    body
  );
  const label = `${name}, ${position}, ${clubCode ?? 'no club'}, ${rarity} card, rating ${rating}${edition ? `, limited edition ${edition.name}, number ${edition.serial} of ${edition.supply}` : ''}`;
  return onPress ? (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens the player profile"
    >
      {framed}
    </Pressable>
  ) : (
    <View accessible accessibilityLabel={label}>
      {framed}
    </View>
  );
}
