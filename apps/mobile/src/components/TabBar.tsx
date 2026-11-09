import { Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, font, type } from '../lib/theme';
import { Gradient } from './Gradient';

const ICONS: Record<string, string> = {
  index: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  squad: 'M8 3 3 5.5 1.5 11l3.5 2 1.5-2.5V21h11V10.5l1.5 2.5 3.5-2L20.5 5.5 16 3c-1 2-2.5 3-4 3S9 5 8 3z',
  collection: 'M4 6h12v14H4zM8 3h12v14',
  leagues: 'M7 4h10v5a5 5 0 0 1-10 0zM5 5H3v2a3 3 0 0 0 3 3M19 5h2v2a3 3 0 0 1-3 3M12 14v4M8 21h8',
  profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
};
const LABELS: Record<string, string> = {
  index: 'Home',
  squad: 'Squad',
  collection: 'Collection',
  leagues: 'Leagues',
  profile: 'Profile',
};

/** Gradient-tile tab bar: active = white 2px icon on a 40×32 gradient tile; inactive = muted outline. */
export interface TabBarProps {
  state: { index: number; routes: { key: string; name: string }[] };
  navigateToTab?: (routeKey: string) => void;
  navigation?: { navigate: (name: string) => void };
}

export function TabBar({ state, navigateToTab, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: color.surface,
        borderTopColor: color.border,
        borderTopWidth: 1,
        paddingBottom: insets.bottom + 6,
        paddingTop: 8,
      }}
    >
      {state.routes.map((r, i) => {
        const active = state.index === i;
        const icon = (
          <Svg
            width={20}
            height={20}
            viewBox="0 0 24 24"
            fill="none"
            stroke={active ? '#FFFFFF' : color.muted}
            strokeWidth={active ? 2 : 1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <Path d={ICONS[r.name] ?? ICONS.index!} />
          </Svg>
        );
        return (
          <Pressable
            key={r.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={LABELS[r.name]}
            onPress={() => (navigateToTab ? navigateToTab(r.key) : navigation?.navigate(r.name))}
            style={{ flex: 1, alignItems: 'center', gap: 4, minHeight: 44 }}
          >
            {active ? (
              <Gradient
                radius={10}
                style={{
                  width: 40,
                  height: 32,
                  alignItems: 'center',
                  justifyContent: 'center',
                  shadowColor: '#3D5AFE',
                  shadowOpacity: 0.3,
                  shadowRadius: 8,
                  shadowOffset: { width: 0, height: 3 },
                }}
              >
                {/* Wrapped in a View: on web an absolutely-positioned gradient paints over bare SVG siblings. */}
                <View>{icon}</View>
              </Gradient>
            ) : (
              <View style={{ width: 40, height: 32, alignItems: 'center', justifyContent: 'center' }}>
                {icon}
              </View>
            )}
            <Text
              style={{
                fontFamily: font.bodySemi,
                fontSize: type.caption,
                color: active ? color.active : color.muted,
              }}
            >
              {LABELS[r.name]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
