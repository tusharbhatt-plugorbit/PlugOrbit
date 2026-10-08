import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {EmptyState} from '../ui';
import {colors, spacing, type} from '../theme';

type Props = {
  /** Opens the same chargers as a list, which needs no map. */
  onViewList: () => void;
};

/**
 * Shown instead of the map when this build has no Google Maps key. Drawing the
 * map anyway would give a blank grey rectangle and no explanation.
 */
export function MapUnavailable({onViewList}: Props) {
  return (
    <View style={styles.wrap} testID="map-unavailable">
      <EmptyState
        icon="map-pin-off"
        title="Map isn’t available"
        body="This build isn’t set up for Google Maps yet. You can still browse nearby chargers as a list."
        primary={{
          label: 'View chargers as a list',
          icon: 'list',
          onPress: onViewList,
        }}
      />
      {__DEV__ && (
        <Text style={styles.dev}>
          Developers: set GOOGLE_MAPS_ANDROID_KEY (or GOOGLE_MAPS_API_KEY) in
          LoginApp/.env, then rebuild the app. See the README.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.mapBg,
    justifyContent: 'center',
    paddingTop: spacing.xxl * 2,
    paddingHorizontal: spacing.lg,
  },
  dev: {
    ...type.caption,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
