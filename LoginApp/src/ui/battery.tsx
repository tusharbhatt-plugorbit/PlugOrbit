import React, {useEffect, useRef} from 'react';
import {Animated, Easing, StyleSheet, View} from 'react-native';
import {colors, radii} from '../theme';
import {useReducedMotion} from './useReducedMotion';

type Props = {
  /** 0-100. */
  percent: number;
  /** Safety reserve, drawn as a tick so "how close am I to it" is visible. */
  reservePct?: number;
  /** Battery level treated as critical (the fill turns red). */
  criticalPct?: number;
  /** The bar sits on a dark card (default) or on a light one. */
  onDark?: boolean;
};

/**
 * The battery as a bar. Colour is never the only signal: the percentage is
 * always printed next to it, and the bar reports itself to screen readers.
 * The fill glides to a new value unless the system asks for reduced motion.
 */
export function BatteryBar({
  percent,
  reservePct,
  criticalPct = 15,
  onDark = true,
}: Props) {
  const reduced = useReducedMotion();
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const width = useRef(new Animated.Value(clamped)).current;

  useEffect(() => {
    if (reduced) {
      width.setValue(clamped);
      return;
    }
    Animated.timing(width, {
      toValue: clamped,
      duration: 500,
      easing: Easing.out(Easing.cubic),
      // Layout property: cannot run on the native driver.
      useNativeDriver: false,
    }).start();
  }, [clamped, reduced, width]);

  const low = clamped <= criticalPct;
  const nearReserve = reservePct !== undefined && clamped <= reservePct + 8;
  const fill = low
    ? colors.dangerOnDark
    : nearReserve
    ? colors.amberOnDark
    : colors.lime;

  return (
    <View
      style={[styles.track, onDark ? styles.trackDark : styles.trackLight]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Battery"
      accessibilityValue={{
        min: 0,
        max: 100,
        now: clamped,
        text: `${clamped}%`,
      }}>
      <Animated.View
        style={[
          styles.fill,
          {
            backgroundColor: fill,
            width: width.interpolate({
              inputRange: [0, 100],
              outputRange: ['0%', '100%'],
            }),
          },
        ]}
      />
      {reservePct !== undefined && reservePct > 0 && reservePct < 100 && (
        <View
          style={[
            styles.reserve,
            {left: `${reservePct}%`},
            onDark ? styles.reserveDark : styles.reserveLight,
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {height: 12, borderRadius: radii.pill, overflow: 'visible'},
  trackDark: {backgroundColor: 'rgba(255,255,255,0.14)'},
  trackLight: {backgroundColor: colors.slateSoft},
  fill: {height: '100%', borderRadius: radii.pill},
  reserve: {
    position: 'absolute',
    top: -3,
    width: 2,
    height: 18,
    borderRadius: 1,
  },
  reserveDark: {backgroundColor: 'rgba(255,255,255,0.7)'},
  reserveLight: {backgroundColor: colors.inkSoft},
});
