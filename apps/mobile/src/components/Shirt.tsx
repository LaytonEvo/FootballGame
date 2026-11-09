import Svg, { Path, Rect, Text as SvgText } from 'react-native-svg';
import type { RarityKey } from '../lib/theme';
import { color, rarityColor } from '../lib/theme';

/** Generic kit-style shirt: white body, rarity-coloured sleeves, collar and side panels. No club kit. */
export function Shirt({ label, rarity, size = 56 }: { label: string; rarity: RarityKey; size?: number }) {
  const c = rarityColor(rarity);
  const h = Math.round((size * 60) / 64);
  const fs = label.length > 2 ? 16 : label.length > 1 ? 21 : 24;
  return (
    <Svg width={size} height={h} viewBox="0 0 64 60" accessibilityLabel={`Shirt ${label}, ${rarity} card`}>
      <Path
        d="M21 5 10 9.5 2.5 22l8.5 5.5 4.5-6.5V55a3 3 0 0 0 3 3h27a3 3 0 0 0 3-3V21l4.5 6.5L61.5 22 54 9.5 43 5c-2 4-6 6.5-11 6.5S23 9 21 5z"
        fill="#FFFFFF"
      />
      <Path d="M21 5 10 9.5 2.5 22l8.5 5.5 4.5-6.5V14z" fill={c} />
      <Path d="M43 5 54 9.5 61.5 22 53 27.5 48.5 21V14z" fill={c} />
      <Path d="M3.8 20 12.6 25.4" stroke="#FFFFFF" strokeWidth={1.6} strokeLinecap="round" opacity={0.85} />
      <Path d="M60.2 20 51.4 25.4" stroke="#FFFFFF" strokeWidth={1.6} strokeLinecap="round" opacity={0.85} />
      <Rect x={15.5} y={24} width={3} height={31} fill={c} opacity={0.9} />
      <Rect x={45.5} y={24} width={3} height={31} fill={c} opacity={0.9} />
      <Path
        d="M32 11.5c5 0 9-2.5 11-6.5l-3-1.2c-1.6 2.8-4.5 4.5-8 4.5s-6.4-1.7-8-4.5L21 5c2 4 6 6.5 11 6.5z"
        fill={c}
      />
      <Path
        d="M32 11.5V58h13.5a3 3 0 0 0 3-3V21l4.5 6.5L61.5 22 54 9.5 43 5c-2 4-6 6.5-11 6.5z"
        fill={color.ink}
        opacity={0.05}
      />
      <Path
        d="M21 5 10 9.5 2.5 22l8.5 5.5 4.5-6.5V55a3 3 0 0 0 3 3h27a3 3 0 0 0 3-3V21l4.5 6.5L61.5 22 54 9.5 43 5c-2 4-6 6.5-11 6.5S23 9 21 5z"
        fill="none"
        stroke={color.ink}
        strokeOpacity={0.3}
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <SvgText
        x={32}
        y={43}
        textAnchor="middle"
        fontFamily="Sora_700Bold"
        fontWeight="700"
        fontSize={fs}
        fill={color.ink}
      >
        {label}
      </SvgText>
    </Svg>
  );
}
