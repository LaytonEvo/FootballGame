import type { ReactNode } from 'react';
import type { TextStyle, ViewStyle } from 'react-native';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { color, font, radius, touch, type } from '../lib/theme';

export function Screen({
  children,
  scroll = true,
  style,
}: {
  children: ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
}) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.background }} edges={['top']}>
      {scroll ? (
        <ScrollView contentContainerStyle={[{ padding: 16, gap: 12, paddingBottom: 32 }, style]}>
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1, padding: 16, gap: 12 }, style]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function H1({ children, style }: { children: ReactNode; style?: TextStyle }) {
  return (
    <Text
      style={[{ fontFamily: font.heading, fontSize: type.h1, color: color.ink }, style]}
      accessibilityRole="header"
    >
      {children}
    </Text>
  );
}
export function H3({ children, style }: { children: ReactNode; style?: TextStyle }) {
  return (
    <Text style={[{ fontFamily: font.headingSemi, fontSize: type.h3, color: color.ink }, style]}>
      {children}
    </Text>
  );
}
export function Body({
  children,
  style,
  muted,
}: {
  children: ReactNode;
  style?: TextStyle;
  muted?: boolean;
}) {
  return (
    <Text
      style={[{ fontFamily: font.body, fontSize: type.body, color: muted ? color.muted : color.ink }, style]}
    >
      {children}
    </Text>
  );
}
export function Small({
  children,
  style,
  muted = true,
}: {
  children: ReactNode;
  style?: TextStyle;
  muted?: boolean;
}) {
  return (
    <Text
      style={[{ fontFamily: font.body, fontSize: type.small, color: muted ? color.muted : color.ink }, style]}
    >
      {children}
    </Text>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    <View
      style={[
        {
          backgroundColor: color.surface,
          borderRadius: radius.card,
          borderWidth: 1,
          borderColor: color.border,
          padding: 16,
          gap: 8,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
  accessibilityHint,
}: {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  accessibilityHint?: string;
}) {
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      accessibilityHint={accessibilityHint}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: Math.max(touch, 50),
          borderRadius: radius.button,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 16,
          backgroundColor: primary ? color.primary : variant === 'secondary' ? color.surface : 'transparent',
          borderWidth: variant === 'secondary' ? 1 : 0,
          borderColor: color.border,
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={primary ? color.onPrimary : color.ink} />
      ) : (
        <Text
          style={{
            fontFamily: font.bodyBold,
            fontSize: type.body,
            color: primary ? color.onPrimary : variant === 'ghost' ? color.active : color.ink,
          }}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function Chip({
  label,
  tone = 'pending',
  icon,
}: {
  label: string;
  tone?: 'landed' | 'missed' | 'pending' | 'void';
  icon?: string;
}) {
  const t =
    tone === 'landed'
      ? color.landed
      : tone === 'missed'
        ? color.missed
        : { bg: color.pending.bg, border: color.border, text: color.pending.text };
  // Never colour alone: every state has an icon too.
  const glyph = icon ?? (tone === 'landed' ? '✓' : tone === 'missed' ? '✕' : tone === 'void' ? '–' : '•');
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: t.bg,
        borderColor: t.border,
        borderWidth: 1,
        borderRadius: radius.chip,
        paddingHorizontal: 8,
        paddingVertical: 3,
      }}
    >
      <Text style={{ color: t.text, fontFamily: font.bodyBold, fontSize: type.caption }}>{glyph}</Text>
      <Text style={{ color: t.text, fontFamily: font.bodySemi, fontSize: type.caption }}>{label}</Text>
    </View>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return children ? (
    <Text
      style={{ color: color.missed.text, fontFamily: font.bodyMedium, fontSize: type.small }}
      accessibilityLiveRegion="polite"
    >
      {children}
    </Text>
  ) : null;
}

export function Loading() {
  return (
    <View
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.background }}
    >
      <ActivityIndicator color={color.active} />
    </View>
  );
}
