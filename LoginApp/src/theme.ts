import {Platform, ViewStyle} from 'react-native';

export const colors = {
  bg: '#0B1220',
  bgRaised: '#131C2E',
  surface: '#FFFFFF',
  lime: '#A2F067',
  limeDark: '#3F8F12',
  limeSoft: '#E3F6D5',
  danger: '#B42318',
  dangerSoft: '#FDE4E4',
  ink: '#0F172A',
  inkSoft: '#334155',
  muted: '#64748B',
  placeholder: '#94A3B8',
  chipBorder: '#334155',
  chipText: '#E2E8F0',
  mapBg: '#EEF1F4',
  road: '#FFFFFF',
  roadMinor: '#E1E5EA',
  park: '#D9EBD2',
  water: '#CFE3F2',
} as const;

export const radii = {sm: 8, md: 14, lg: 20, xl: 24, pill: 999} as const;

export const spacing = {xs: 4, sm: 8, md: 12, lg: 16, xl: 20} as const;

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
