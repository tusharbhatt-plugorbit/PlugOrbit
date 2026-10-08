import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {colors, elevation, radii, spacing, type} from '../theme';
import {PrimaryButton, SecondaryButton} from './Buttons';
import {Icon} from './Icon';

type Props = {
  /**
   * `denied`: the user said no. `unavailable`: location services are off.
   * `no-fix`: everything is on but no position arrived (indoors, weak signal).
   */
  kind: 'denied' | 'unavailable' | 'no-fix';
  /** Ask again (re-prompts when the OS still allows it). */
  onRetry: () => void;
  /** Where permission can always be changed. Not offered for `no-fix`. */
  onOpenSettings?: () => void;
  /**
   * Make Settings the main action. True where asking again cannot work: iOS
   * never prompts twice, and Android stops after "Don't ask again".
   */
  settingsFirst?: boolean;
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
  'no-fix': {
    title: 'Couldn’t find your location',
    body: 'Move to a spot with a clearer signal, then try again.',
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
  settingsFirst = false,
  onDismiss,
}: Props) {
  const copy = COPY[kind];
  const first = settingsFirst && onOpenSettings;
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
        {first ? (
          <>
            <PrimaryButton
              compact
              label="Open settings"
              icon="settings"
              onPress={onOpenSettings}
              style={styles.primary}
            />
            <SecondaryButton compact label={copy.retry} onPress={onRetry} />
          </>
        ) : (
          <>
            <PrimaryButton
              compact
              label={copy.retry}
              icon="locate-fixed"
              onPress={onRetry}
              style={styles.primary}
            />
            {onOpenSettings && (
              <SecondaryButton
                compact
                label="Settings"
                onPress={onOpenSettings}
              />
            )}
          </>
        )}
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
