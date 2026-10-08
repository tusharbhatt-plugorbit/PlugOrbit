import {Platform, ViewStyle} from 'react-native';

export const colors = {
  bg: '#0B1220',
  bgRaised: '#131C2E',
  surface: '#FFFFFF',
  lime: '#A2F067',
  limeDark: '#33790E',
  limeSoft: '#E3F6D5',
  danger: '#B42318',
  dangerSoft: '#FDE4E4',
  ink: '#0F172A',
  inkSoft: '#334155',
  muted: '#58687E',
  placeholder: '#94A3B8',
  chipBorder: '#334155',
  chipText: '#E2E8F0',
  mapBg: '#EEF1F4',
  // Body of every content screen: the light, rounded-top sheet under the dark
  // header (same surface the Home map sits on).
  body: '#EEF1F4',
  divider: '#E2E8F0',
  inputBg: '#EEF2F7',
  inputBorder: '#D5DDE8',
  // Data-trust semantics. Lime = verified live; amber = estimated; blue = a
  // person confirmed it; slate = unknown. Tailwind amber/blue 700/100, the same
  // slate family the rest of the palette comes from.
  amber: '#A94C08',
  amberSoft: '#FEF3C7',
  info: '#1D4ED8',
  infoSoft: '#DBEAFE',
  slateSoft: '#E2E8F0',
  limeHalo: 'rgba(162, 240, 103, 0.08)',
  limeHaloBorder: 'rgba(162, 240, 103, 0.28)',
  scrim: 'rgba(2, 6, 23, 0.55)',
  road: '#FFFFFF',
  roadMinor: '#E1E5EA',
  park: '#D9EBD2',
  water: '#CFE3F2',
} as const;

export const radii = {sm: 8, md: 14, lg: 20, xl: 24, pill: 999} as const;

export const spacing = {xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28} as const;

// Control sizes seen on the approved screens: search 52, chips 36, CTA 50-54;
// 64 is the large CTA for a screen's single main action.
export const sizes = {
  tap: 44,
  chip: 36,
  field: 52,
  button: 54,
  buttonLarge: 64,
  buttonCompact: 44,
  header: 44,
  tabBar: 64,
  maxContent: 560,
} as const;

/**
 * Invisible touch-area extension so compact controls (36-40px chips, tabs)
 * still give a 44px target without changing how they look.
 */
export function slopFor(height: number): {top: number; bottom: number} {
  const v = Math.max(0, Math.ceil((sizes.tap - height) / 2));
  return {top: v, bottom: v};
}

// Type scale lifted from Welcome/Login/Home (weights 500-800, no custom font).
export const type = {
  brand: {fontSize: 24, fontWeight: '800', letterSpacing: 0.5},
  display: {fontSize: 26, fontWeight: '700'},
  h1: {fontSize: 22, fontWeight: '800'},
  title: {fontSize: 18, fontWeight: '700', letterSpacing: 0.2},
  heading: {fontSize: 16, fontWeight: '800'},
  button: {fontSize: 16, fontWeight: '800'},
  bodyStrong: {fontSize: 14, fontWeight: '700'},
  body: {fontSize: 14, fontWeight: '500'},
  label: {fontSize: 13, fontWeight: '700'},
  caption: {fontSize: 12.5, fontWeight: '500'},
  micro: {fontSize: 11, fontWeight: '800', letterSpacing: 0.6},
  // One oversized figure per screen (battery %, price): the "hero" number.
  hero: {fontSize: 56, fontWeight: '800', letterSpacing: -1},
} as const;

// One elevation recipe for iOS (shadow*) and Android (elevation).
export function elevation(level: 1 | 2 | 3): ViewStyle {
  const o = {1: 0.12, 2: 0.18, 3: 0.24}[level];
  const r = {1: 4, 2: 10, 3: 18}[level];
  return Platform.select<ViewStyle>({
    android: {elevation: level * 3},
    default: {
      shadowColor: '#020617',
      shadowOpacity: o,
      shadowRadius: r,
      shadowOffset: {width: 0, height: level * 2},
    },
  }) as ViewStyle;
}
