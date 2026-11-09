import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Rect } from 'react-native-svg';
import { color } from '../lib/theme';

/** Striped green pitch with white markings. Children are laid out in rows: FWD, MID MID, DEF, GK. */
export function Pitch({ children }: { children: ReactNode }) {
  const stripes = 8;
  return (
    <View style={{ borderRadius: 16, overflow: 'hidden', paddingVertical: 12 }}>
      <Svg
        style={StyleSheet.absoluteFill}
        width="100%"
        height="100%"
        viewBox="0 0 100 160"
        preserveAspectRatio="none"
      >
        {Array.from({ length: stripes }, (_, i) => (
          <Rect
            key={i}
            x="0"
            y={(i * 160) / stripes}
            width="100"
            height={160 / stripes}
            fill={i % 2 ? color.pitch.stripeB : color.pitch.stripeA}
          />
        ))}
        <Rect x="4" y="4" width="92" height="152" fill="none" stroke={color.pitch.lines} strokeWidth="0.6" />
        <Line x1="4" y1="80" x2="96" y2="80" stroke={color.pitch.lines} strokeWidth="0.6" />
        <Circle cx="50" cy="80" r="12" fill="none" stroke={color.pitch.lines} strokeWidth="0.6" />
        <Rect x="28" y="4" width="44" height="18" fill="none" stroke={color.pitch.lines} strokeWidth="0.6" />
        <Rect
          x="28"
          y="138"
          width="44"
          height="18"
          fill="none"
          stroke={color.pitch.lines}
          strokeWidth="0.6"
        />
      </Svg>
      <View style={{ gap: 14 }}>{children}</View>
    </View>
  );
}

export function PitchRow({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', justifyContent: 'space-evenly' }}>{children}</View>;
}

/** Order of starter slots on the pitch, top to bottom. */
export const PITCH_ROWS = [[4], [2, 3], [1], [0]];
