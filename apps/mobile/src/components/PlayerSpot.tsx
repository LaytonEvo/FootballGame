import { Pressable, Text, View } from 'react-native';
import type { Position, Rarity } from '@ff/shared';
import { color, font, radius } from '../lib/theme';
import { plateName } from '../lib/format';
import { Shirt } from './Shirt';

export interface SpotChip {
  label: string;
  value?: string;
  state?: 'empty' | 'set' | 'bold' | 'landed' | 'missed' | 'pending' | 'void';
}

/** A player on the pitch: shirt, captain badge, name plate with fixture/score, two action chips. */
export function PlayerSpot({
  name,
  position,
  shirt,
  rarity,
  fixture,
  captain,
  chips,
  bubble,
  warning,
  onPress,
  onLongPressChip,
  accessibilityHint,
}: {
  name: string;
  position: Position;
  shirt: string;
  rarity: Rarity;
  fixture: string;
  captain?: boolean;
  chips: SpotChip[];
  bubble?: string;
  warning?: string | null;
  onPress?: () => void;
  onLongPressChip?: (i: number) => void;
  accessibilityHint?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${position}, ${fixture}${captain ? ', captain' : ''}${warning ? `, warning: ${warning}` : ''}. ${chips.map((c) => `${c.label} ${c.value ?? ''} ${c.state ?? ''}`).join(', ')}`}
      accessibilityHint={accessibilityHint}
      style={{ alignItems: 'center', width: 112, gap: 3 }}
    >
      <View>
        <Shirt label={shirt} rarity={rarity} size={52} />
        {captain ? (
          <View
            style={{
              position: 'absolute',
              right: -6,
              top: -4,
              width: 22,
              height: 22,
              borderRadius: 11,
              backgroundColor: color.ink,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 2,
              borderColor: '#fff',
            }}
          >
            <Text style={{ color: '#fff', fontFamily: font.bodyBold, fontSize: 11 }}>C</Text>
          </View>
        ) : null}
        {bubble ? (
          <View
            style={{
              position: 'absolute',
              left: -10,
              top: -6,
              minWidth: 28,
              paddingHorizontal: 5,
              height: 22,
              borderRadius: 11,
              backgroundColor: color.active,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontFamily: font.heading, fontSize: 12 }}>{bubble}</Text>
          </View>
        ) : null}
      </View>
      <View style={{ borderRadius: 6, overflow: 'hidden', alignItems: 'center', minWidth: 96 }}>
        <Text
          numberOfLines={1}
          style={{
            backgroundColor: color.namePlate.top,
            alignSelf: 'stretch',
            textAlign: 'center',
            fontFamily: font.bodyBold,
            fontSize: 12,
            color: color.namePlate.text,
            paddingHorizontal: 6,
            paddingTop: 2,
          }}
        >
          {plateName(name)}
        </Text>
        <Text
          numberOfLines={1}
          style={{
            backgroundColor: color.namePlate.bottom,
            alignSelf: 'stretch',
            textAlign: 'center',
            fontFamily: font.bodyMedium,
            fontSize: 11,
            color: color.muted,
            paddingHorizontal: 6,
            paddingBottom: 2,
          }}
        >
          {fixture}
        </Text>
      </View>
      {warning ? (
        <Text
          numberOfLines={2}
          style={{
            alignSelf: 'stretch',
            textAlign: 'center',
            backgroundColor: color.missed.bg,
            color: color.missed.text,
            borderRadius: 6,
            paddingHorizontal: 4,
            fontFamily: font.bodyBold,
            fontSize: 10,
          }}
        >
          ⚠ {warning}
        </Text>
      ) : null}
      <View style={{ gap: 3, alignSelf: 'stretch' }}>
        {chips.map((c, i) => {
          const empty = c.state === 'empty';
          const tone = c.state === 'landed' ? color.landed : c.state === 'missed' ? color.missed : null;
          const glyph =
            c.state === 'landed'
              ? '✓ '
              : c.state === 'missed'
                ? '✕ '
                : c.state === 'pending'
                  ? '• '
                  : c.state === 'void'
                    ? '– '
                    : '';
          return (
            <Pressable
              key={i}
              onPress={onPress}
              onLongPress={onLongPressChip ? () => onLongPressChip(i) : undefined}
              accessibilityLabel={empty ? 'Add an action' : `${c.label} ${c.value ?? ''}`}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                borderRadius: radius.chip,
                paddingHorizontal: 6,
                paddingVertical: 3,
                minHeight: 24,
                backgroundColor: empty ? 'rgba(255,255,255,0.15)' : (tone?.bg ?? '#FFFFFF'),
                borderWidth: c.state === 'bold' ? 2 : 1,
                borderStyle: empty ? 'dashed' : 'solid',
                borderColor:
                  c.state === 'bold' ? color.boldAction : empty ? '#FFFFFF' : (tone?.border ?? '#FFFFFF'),
              }}
            >
              <Text
                numberOfLines={1}
                style={{
                  flexShrink: 1,
                  fontFamily: font.bodySemi,
                  fontSize: 11,
                  color: empty ? '#FFFFFF' : (tone?.text ?? color.ink),
                }}
              >
                {glyph}
                {c.label}
              </Text>
              {c.value ? (
                <Text style={{ fontFamily: font.bodyBold, fontSize: 11, color: tone?.text ?? color.active }}>
                  {c.value}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </Pressable>
  );
}
