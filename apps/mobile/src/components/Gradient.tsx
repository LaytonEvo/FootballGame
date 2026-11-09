import type { ReactNode } from 'react';
import { useId } from 'react';
import type { ViewStyle } from 'react-native';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { gradient } from '../lib/theme';

/** Aqua-to-blue 135° gradient (pitch band, active tab tile, pack, share card). */
export function Gradient({
  style,
  children,
  radius = 0,
  colors = gradient,
}: {
  style?: ViewStyle;
  children?: ReactNode;
  radius?: number;
  colors?: readonly string[];
}) {
  // Unique id per instance: on web, SVG gradient ids are document-global.
  const id = `g${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View style={[{ overflow: 'hidden', borderRadius: radius }, style]}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            {colors.map((c, i) => (
              <Stop key={c + i} offset={String(i / Math.max(1, colors.length - 1))} stopColor={c} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
      {children}
    </View>
  );
}
