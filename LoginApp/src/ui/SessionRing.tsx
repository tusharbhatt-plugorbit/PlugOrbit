import {useAppearance, useThemedStyles} from '../appearance';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Line,
  Stop,
} from 'react-native-svg';
import { colors, type } from '../theme';

const SIZE = 232;
const STROKE = 18;
const RADIUS = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * RADIUS;

/**
 * The charging hero: battery % as a lime arc, with a tick at the target SoC so
 * "to 80%" is visible at a glance.
 */
export function SessionRing({
  percent,
  target,
  caption = 'vehicle battery',
  dark = false,
}: {
  percent: number;
  target?: number;
  caption?: string;
  dark?: boolean;
}) {
  const {colors}=useAppearance();
  const styles=useThemedStyles(baseStyles);

  const p = Math.min(100, Math.max(0, percent));
  const angle =
    target !== undefined ? (target / 100) * 2 * Math.PI - Math.PI / 2 : 0;
  const inner = RADIUS - STROKE / 2 - 1;
  const outer = RADIUS + STROKE / 2 + 1;
  const c = SIZE / 2;
  return (
    <View
      style={styles.wrap}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Battery ${Math.round(p)} percent${
        target !== undefined ? `, charging to ${target} percent` : ''
      }`}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(p) }}
    >
      <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <Defs>
          <LinearGradient id="charge-progress" x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor={colors.electric} />
            <Stop offset="0.5" stopColor={colors.cyan} />
            <Stop offset="1" stopColor={colors.lime} />
          </LinearGradient>
        </Defs>
        <Circle
          cx={c}
          cy={c}
          r={RADIUS}
          stroke={dark ? colors.bgRaised : colors.slateSoft}
          strokeWidth={STROKE}
          fill="none"
        />
        <Circle
          cx={c}
          cy={c}
          r={RADIUS}
          stroke="url(#charge-progress)"
          strokeWidth={STROKE}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${(p / 100) * CIRC} ${CIRC}`}
          transform={`rotate(-90 ${c} ${c})`}
        />
        {target !== undefined && (
          <Line
            x1={c + inner * Math.cos(angle)}
            y1={c + inner * Math.sin(angle)}
            x2={c + outer * Math.cos(angle)}
            y2={c + outer * Math.sin(angle)}
            stroke={colors.bg}
            strokeWidth={3}
            strokeLinecap="round"
          />
        )}
      </Svg>
      <View style={styles.center} pointerEvents="none">
        <Text style={[styles.percent, dark && styles.lightText]}>
          {Math.round(p)}%
        </Text>
        <Text style={[styles.caption, dark && styles.lightCaption]}>
          {caption}
        </Text>
      </View>
    </View>
  );
}

const baseStyles = StyleSheet.create({
  lightText: { color: '#FFFFFF' },
  lightCaption: { color: '#CBD5E1' },
  wrap: { width: SIZE, height: SIZE, alignSelf: 'center' },
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  percent: {
    fontSize: 56,
    fontWeight: '800',
    color: colors.ink,
    letterSpacing: -1,
  },
  caption: { ...type.caption, color: colors.muted, marginTop: 2 },
});
