import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {EmptyState} from '../ui';
import {colors, spacing, type} from '../theme';

type Props = {
  /** Opens the same chargers as a list, which needs no map. */
  onViewList: () => void;
  /**
   * Why there is no map. `key`: this build has no Google Maps key (the
   * default). `component`: the fallback map's native component is not in this
   * build, or its page failed to start.
   */
  reason?: 'key' | 'component';
};

const COPY = {
  key: {
    body: 'This build isn’t set up for Google Maps yet. You can still browse nearby chargers as a list.',
    dev: 'Developers: set GOOGLE_MAPS_ANDROID_KEY (or GOOGLE_MAPS_API_KEY) in LoginApp/.env, then rebuild the app. See the README.',
  },
  component: {
    body: 'The map couldn’t start on this device. You can still browse nearby chargers as a list.',
    dev: 'Developers: run npm install in LoginApp, then rebuild the app (npm run android) so the map component is included. See the README.',
  },
} as const;

/**
 * Shown instead of the map when it cannot be drawn at all. Drawing it anyway
 * would give a blank rectangle and no explanation.
 */
export function MapUnavailable({onViewList, reason = 'key'}: Props) {
  const copy = COPY[reason];
  return (
    <View style={styles.wrap} testID="map-unavailable">
      <EmptyState
        icon="map-pin-off"
        title="Map isn’t available"
        body={copy.body}
        primary={{
          label: 'View chargers as a list',
          icon: 'list',
          onPress: onViewList,
        }}
      />
      {__DEV__ && <Text style={styles.dev}>{copy.dev}</Text>}
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
