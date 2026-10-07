import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {computeSessionMetrics} from '../domain/charging';
import {
  useNavigation,
  useNavigationState,
} from '../navigation/NavigationContext';
import type {RouteName} from '../navigation/params';
import {REGISTRY} from '../navigation/registry';
import {useApp} from '../store/appStore';
import {colors, elevation, radii, sizes, spacing, type} from '../theme';
import {Icon} from '../ui';
import {useNow} from '../ui/useNow';
import {resumeSession} from './initialStack';

// Screens that already show the session, so the banner would be redundant.
const HIDE_ON: readonly RouteName[] = [
  'ScanQr',
  'StartCharging',
  'ActiveSession',
  'Payment',
  'PaymentFailure',
  'Receipt',
  'Feedback',
  'VehicleSetup',
  'ManualSoc',
];

/** Persistent "charging in progress" entry point while a session is open. */
export function SessionBanner() {
  const nav = useNavigation();
  const {current, depth} = useNavigationState();
  const insets = useSafeAreaInsets();
  const session = useApp(s => s.session);
  const now = useNow(5000);

  if (!session || HIDE_ON.includes(current)) {
    return null;
  }
  const metrics = computeSessionMetrics(session, now);
  const label =
    session.status === 'active'
      ? `Charging ${Math.round(metrics.socPercent)}% • ${session.stationName}`
      : session.status === 'payment_failed'
      ? 'Payment needs attention'
      : 'Session ended • pay now';
  // Sit above the tab bar when it is visible (tab roots AND stack screens that
  // keep it, like Nearby chargers), otherwise near the bottom edge.
  const tabBarVisible = depth === 0 || !!REGISTRY[current]?.tabBar;
  const bottom =
    (tabBarVisible ? sizes.tabBar + insets.bottom : insets.bottom) +
    spacing.md;
  return (
    <View style={[styles.wrap, {bottom}]} pointerEvents="box-none">
      <Pressable
        onPress={() => resumeSession(nav)}
        accessibilityRole="button"
        accessibilityLabel={label}
        testID="session-banner"
        style={({pressed}) => [
          styles.banner,
          elevation(3),
          pressed && {opacity: 0.9},
        ]}>
        <View style={styles.icon}>
          <Icon name="zap" size={16} color={colors.ink} filled />
        </View>
        <Text style={styles.text} numberOfLines={1}>
          {label}
        </Text>
        <Icon name="chevron-right" size={16} color={colors.lime} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    alignItems: 'center',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    maxWidth: 480,
    width: '100%',
    height: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.limeHaloBorder,
  },
  icon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {...type.label, color: '#FFFFFF', flex: 1},
});
