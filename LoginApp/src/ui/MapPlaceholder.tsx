import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {colors, radii, spacing, type} from '../theme';
import {Icon} from './Icon';

/**
 * Stands in for a small embedded map (route preview, station mini map) when
 * this build has no Google Maps key. Without it the SDK would draw a blank grey
 * rectangle with no explanation. The screen's own text still carries the route
 * and station details, so this only has to say why there is no picture.
 */
export function MapPlaceholder({height = 200}: {height?: number}) {
  return (
    <View
      style={[styles.wrap, {height}]}
      testID="map-placeholder"
      accessibilityRole="text"
      accessibilityLabel="Map isn’t available in this build">
      <Icon name="map-pin-off" size={24} color={colors.muted} />
      <Text style={styles.title}>Map isn’t available</Text>
      {__DEV__ && (
        <Text style={styles.dev}>
          Set GOOGLE_MAPS_ANDROID_KEY in LoginApp/.env and rebuild.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radii.lg,
    backgroundColor: colors.mapBg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.xs,
  },
  title: {...type.caption, color: colors.muted, fontWeight: '600'},
  dev: {...type.caption, color: colors.muted, textAlign: 'center'},
});
