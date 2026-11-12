import { Pressable, Text, View } from 'react-native';
import type { Position, Rarity } from '@ff/shared';
import { color, font, radius, rarityColor, type } from '../lib/theme';
import { Shirt } from './Shirt';

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
}: {
  name: string;
  position: Position;
  clubCode: string | null;
  rarity: Rarity;
  rating: number;
  size?: 'lg' | 'sm';
  level?: number;
  onPress?: () => void;
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
  const label = `${name}, ${position}, ${clubCode ?? 'no club'}, ${rarity} card, rating ${rating}`;
  return onPress ? (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens the player profile"
    >
      {body}
    </Pressable>
  ) : (
    <View accessible accessibilityLabel={label}>
      {body}
    </View>
  );
}
