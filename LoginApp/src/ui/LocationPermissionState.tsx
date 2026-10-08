import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {colors, elevation, radii, spacing, type} from '../theme';
import {PrimaryButton, SecondaryButton} from './Buttons';
import {Icon} from './Icon';

type Props = {
  /** `denied`: the user said no. `unavailable`: location services are off. */
  kind: 'denied' | 'unavailable';
  /** Ask again (re-prompts when the OS still allows it). */
  onRetry: () => void;
  /** Where permission can always be changed. */
  onOpenSettings: () => void;
  /** Carry on around the default area without this card. */
  onDismiss?: () => void;
};

const COPY = {
  denied: {
    title: 'Location access needed',
    body: 'Enable location permission to find EV chargers near you.',
    retry: 'Allow location',
  },
  unavailable: {
    title: 'Location is turned off',
    body: 'Turn on location services to find EV chargers near you.',
    retry: 'Try again',
  },
} as const;

/**
 * Floats over the map when we could not get the device location. Says what is
 * wrong in one line, offers the fix (ask again / open Settings) and still lets
 * the person carry on.
 */
export function LocationPermissionState({
  kind,
  onRetry,
  onOpenSettings,
  onDismiss,
}: Props) {
  const copy = COPY[kind];
  return (
    <View
      style={[styles.card, elevation(2)]}
      accessibilityRole="alert"
      testID="location-permission">
      <View style={styles.head}>
        <View style={styles.icon}>
          <Icon name="map-pin-off" size={20} color={colors.amber} />
        </View>
        <View style={styles.text}>
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.body}>{copy.body}</Text>
        </View>
        {onDismiss && (
          <Pressable
            onPress={onDismiss}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            style={styles.close}>
            <Icon name="x" size={14} color={colors.ink} />
          </Pressable>
        )}
      </View>
      <View style={styles.actions}>
        <PrimaryButton
          compact
          label={copy.retry}
          icon="locate-fixed"
          onPress={onRetry}
          style={styles.primary}
        />
        <SecondaryButton compact label="Settings" onPress={onOpenSettings} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  head: {flexDirection: 'row', gap: spacing.md},
  icon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.amberSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {flex: 1, gap: 2},
  title: {...type.heading, color: colors.ink},
  body: {...type.caption, color: colors.inkSoft},
  actions: {flexDirection: 'row', gap: spacing.sm},
  primary: {flex: 1},
  close: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
