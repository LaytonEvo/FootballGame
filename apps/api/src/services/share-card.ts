import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { DISCLAIMER } from '@ff/shared';
import type { Recap } from './recap.js';
import { GAME_NAME } from './recap.js';

const require = createRequire(import.meta.url);
const font = (pkg: string, file: string) => readFileSync(require.resolve(`${pkg}/${file}`));
let fonts: { name: string; data: Buffer; weight: 400 | 500 | 600 | 700; style: 'normal' }[] | null = null;
function loadFonts() {
  fonts ??= [
    {
      name: 'Sora',
      data: font('@expo-google-fonts/sora', '700Bold/Sora_700Bold.ttf'),
      weight: 700,
      style: 'normal',
    },
    {
      name: 'Sora',
      data: font('@expo-google-fonts/sora', '600SemiBold/Sora_600SemiBold.ttf'),
      weight: 600,
      style: 'normal',
    },
    {
      name: 'DM Sans',
      data: font('@expo-google-fonts/dm-sans', '500Medium/DMSans_500Medium.ttf'),
      weight: 500,
      style: 'normal',
    },
    {
      name: 'DM Sans',
      data: font('@expo-google-fonts/dm-sans', '700Bold/DMSans_700Bold.ttf'),
      weight: 700,
      style: 'normal',
    },
  ];
  return fonts;
}

const RARITY: Record<string, string> = {
  bronze: '#A9683A',
  silver: '#7C8796',
  gold: '#B8860B',
  elite: '#6A55E0',
};

/** Generic kit-style shirt (no club kit or crest) as an SVG data URI. */
function shirtSvg(rarity: string) {
  const c = RARITY[rarity] ?? RARITY.gold;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 60"><path d="M21 5 10 9.5 2.5 22l8.5 5.5 4.5-6.5V55a3 3 0 0 0 3 3h27a3 3 0 0 0 3-3V21l4.5 6.5L61.5 22 54 9.5 43 5c-2 4-6 6.5-11 6.5S23 9 21 5z" fill="#fff"/><path d="M21 5 10 9.5 2.5 22l8.5 5.5 4.5-6.5V14z" fill="${c}"/><path d="M43 5 54 9.5 61.5 22 53 27.5 48.5 21V14z" fill="${c}"/><rect x="15.5" y="24" width="3" height="31" fill="${c}"/><rect x="45.5" y="24" width="3" height="31" fill="${c}"/><path d="M32 11.5c5 0 9-2.5 11-6.5l-3-1.2c-1.6 2.8-4.5 4.5-8 4.5s-6.4-1.7-8-4.5L21 5c2 4 6 6.5 11 6.5z" fill="${c}"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

type El = { type: string; props: Record<string, unknown> };
const h = (
  type: string,
  style: Record<string, unknown>,
  ...children: (El | string | null | false)[]
): El => ({
  type,
  props: {
    style: { display: 'flex', ...style },
    children: children.filter((c) => c !== null && c !== false),
  },
});
const img = (src: string, w: number, hgt: number): El => ({
  type: 'img',
  props: { src, width: w, height: hgt },
});
/** Short enough for a shirt caption: "Tolentino Coelho de Lima" → "Lima". */
const cardName = (n: string) => (n.length > 12 ? (n.split(' ').at(-1) ?? n) : n);
const ordinal = (n: number) =>
  `${n}${['th', 'st', 'nd', 'rd'][((n % 100) - 20) % 10] ?? ['th', 'st', 'nd', 'rd'][n % 100] ?? 'th'}`;

export type ShareFormat = 'story' | 'square';
export const SHARE_SIZES: Record<ShareFormat, { width: number; height: number }> = {
  story: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
};

function card(r: Recap, format: ShareFormat, joinUrl: string): El {
  const story = format === 'story';
  const s = story ? 2 : 1.3;
  const league = r.leagues[0];
  const move =
    league && league.previousRank
      ? league.rank < league.previousRank
        ? ` ▲${league.previousRank - league.rank}`
        : league.rank > league.previousRank
          ? ` ▼${league.rank - league.previousRank}`
          : ''
      : '';
  const starters = r.five.filter((p) => p.slot < 5);
  const size = SHARE_SIZES[format];
  const shirtW = Math.round(64 * s * 0.9);
  const shirtH = Math.round(60 * s * 0.9);
  return h(
    'div',
    // Satori sizes content-box: no horizontal padding (keeps rows centred) and height minus the vertical padding.
    {
      width: size.width,
      height: size.height - 76 * s,
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: 48 * s,
      paddingBottom: 28 * s,
      color: '#fff',
      fontFamily: 'DM Sans',
      backgroundImage: 'linear-gradient(135deg, #00D9C0, #3D5AFE)',
    },
    h(
      'div',
      { flexDirection: 'column', alignItems: 'center' },
      h(
        'div',
        { fontFamily: 'Sora', fontWeight: 700, fontSize: 30 * s, letterSpacing: 2 },
        GAME_NAME.toUpperCase(),
      ),
      h('div', { fontSize: 22 * s, opacity: 0.9, marginTop: 6 }, `GW${r.gameweek.number}`),
    ),
    h(
      'div',
      { flexDirection: 'column', alignItems: 'center' },
      h('div', { fontSize: 24 * s, fontWeight: 500 }, `${r.displayName} scored`),
      h(
        'div',
        { fontFamily: 'Sora', fontWeight: 700, fontSize: (story ? 150 : 120) * s, lineHeight: 1 },
        String(r.points),
      ),
      h('div', { fontFamily: 'Sora', fontWeight: 600, fontSize: 22 * s, letterSpacing: 4 }, 'PTS'),
      h(
        'div',
        { fontSize: 22 * s, marginTop: 10 * s },
        `${r.actionsLanded} of ${r.actionsPicked} actions landed`,
      ),
    ),
    h(
      'div',
      { gap: 14 * s, justifyContent: 'center' },
      ...starters.map((p) =>
        h(
          'div',
          { flexDirection: 'column', alignItems: 'center', width: story ? 170 : 160 },
          h(
            'div',
            {
              width: shirtW,
              height: shirtH,
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
            },
            img(shirtSvg(p.rarity), shirtW, shirtH),
            h(
              'div',
              {
                position: 'absolute',
                top: Math.round(shirtH * 0.45),
                left: 0,
                width: shirtW,
                justifyContent: 'center',
                fontFamily: 'Sora',
                fontWeight: 700,
                fontSize: Math.round(12 * s),
                color: '#10153A',
              },
              p.shirtNumber ? String(p.shirtNumber) : p.position,
            ),
          ),
          h('div', { fontSize: 16 * s, fontWeight: 700, marginTop: 6 }, cardName(p.name)),
          h(
            'div',
            { fontFamily: 'Sora', fontWeight: 700, fontSize: 20 * s },
            `${p.points}${p.captain ? ' (C)' : ''}`,
          ),
        ),
      ),
    ),
    h(
      'div',
      { flexDirection: 'column', alignItems: 'center', gap: 10 * s },
      r.best
        ? h(
            'div',
            {
              backgroundColor: 'rgba(255,255,255,0.18)',
              borderRadius: 999,
              padding: `${8 * s}px ${18 * s}px`,
              fontSize: 20 * s,
            },
            `Best action: ${cardName(r.best.name)} ${r.best.label}${r.best.bold ? ' (bold)' : ''}  +${r.best.points}`,
          )
        : null,
      league ? h('div', { fontSize: 20 * s }, `${league.name} · ${ordinal(league.rank)}${move}`) : null,
    ),
    h(
      'div',
      {
        flexDirection: 'column',
        alignItems: 'center',
        backgroundColor: '#fff',
        color: '#10153A',
        borderRadius: 24 * s,
        paddingTop: 14 * s,
        paddingBottom: 14 * s,
        paddingLeft: 28 * s,
        paddingRight: 28 * s,
      },
      h('div', { fontSize: 18 * s }, 'Think you can beat that? Join with code'),
      h(
        'div',
        { fontFamily: 'Sora', fontWeight: 700, fontSize: 34 * s, letterSpacing: 4, color: '#3D5AFE' },
        r.inviteCode,
      ),
      h('div', { fontSize: 13 * s, color: '#5A6178' }, joinUrl.replace(/^https?:\/\//, '')),
      h(
        'div',
        {
          fontSize: 9 * s,
          color: '#5A6178',
          marginTop: 6 * s,
          maxWidth: size.width - 160,
          textAlign: 'center',
        },
        DISCLAIMER,
      ),
    ),
  );
}

/** Server-rendered share image (PNG). No crests, kits or photos: names, numbers and rarity shirts only. */
export async function renderShareCard(r: Recap, format: ShareFormat, joinUrl: string): Promise<Buffer> {
  const { width, height } = SHARE_SIZES[format];
  const svg = await satori(card(r, format, joinUrl) as never, { width, height, fonts: loadFonts() });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng());
}
