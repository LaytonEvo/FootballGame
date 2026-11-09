import tokens from '../../../../design/tokens.json';

/** Clean Fantasy theme — values come straight from design/tokens.json. Light only in the MVP. */
export const color = tokens.color;
export const radius = tokens.radius_px;
export const type = tokens.type_scale_px;
export const space = tokens.spacing_px;
export const touch = tokens.touch_target_min_px;
export const gradient = ['#00D9C0', '#3D5AFE'] as const;

export const font = {
  heading: 'Sora_700Bold',
  headingSemi: 'Sora_600SemiBold',
  body: 'DMSans_400Regular',
  bodyMedium: 'DMSans_500Medium',
  bodySemi: 'DMSans_600SemiBold',
  bodyBold: 'DMSans_700Bold',
};

export type RarityKey = keyof typeof tokens.color.rarity;
export const rarityColor = (r: RarityKey) => tokens.color.rarity[r];
