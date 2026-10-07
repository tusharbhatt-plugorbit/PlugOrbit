import React, {useEffect, useRef} from 'react';
import {Animated, StyleSheet, Text, View, ViewStyle} from 'react-native';
import {useDemo} from '../store/demoStore';
import {colors, elevation, radii, spacing, type} from '../theme';
import {PrimaryButton, SecondaryButton} from './Buttons';
import {Icon, IconName} from './Icon';

/** Shown on every screen while the (simulated) connection is down. */
export function OfflineBanner({message}: {message?: string}) {
  const offline = useDemo(s => s.offline);
  if (!offline) {
    return null;
  }
  return (
    <View
      style={styles.offline}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite">
      <Icon name="wifi-off" size={16} color={colors.amber} />
      <Text style={styles.offlineText}>
        {message ??
          'You’re offline. Showing saved data; some actions are paused.'}
      </Text>
    </View>
  );
}

type PanelProps = {
  icon: IconName;
  title: string;
  body?: string;
  tone?: 'default' | 'warn' | 'danger';
  primary?: {label: string; onPress: () => void; icon?: IconName};
  secondary?: {label: string; onPress: () => void};
  testID?: string;
  compact?: boolean;
};

const PANEL_TONE = {
  default: {bg: colors.limeSoft, fg: colors.limeDark},
  warn: {bg: colors.amberSoft, fg: colors.amber},
  danger: {bg: colors.dangerSoft, fg: colors.danger},
} as const;

function Panel({
  icon,
  title,
  body,
  tone = 'default',
  primary,
  secondary,
  testID,
  compact,
}: PanelProps) {
  const t = PANEL_TONE[tone];
  return (
    <View
      style={[styles.panel, compact && styles.panelCompact]}
      testID={testID}>
      <View style={[styles.panelIcon, {backgroundColor: t.bg}]}>
        <Icon name={icon} size={28} color={t.fg} />
      </View>
      <Text style={styles.panelTitle} accessibilityRole="header">
        {title}
      </Text>
      {body ? <Text style={styles.panelBody}>{body}</Text> : null}
      {primary && (
        <PrimaryButton
          label={primary.label}
          icon={primary.icon}
          onPress={primary.onPress}
          style={styles.panelBtn}
        />
      )}
      {secondary && (
        <SecondaryButton
          label={secondary.label}
          onPress={secondary.onPress}
          style={styles.panelBtn}
        />
      )}
    </View>
  );
}

export function EmptyState(props: Omit<PanelProps, 'tone'>) {
  return <Panel {...props} />;
}

export function ErrorState({
  title = 'Something went wrong',
  body = 'We couldn’t load this. Check your connection and try again.',
  onRetry,
  icon = 'triangle-alert',
  ...rest
}: Partial<Omit<PanelProps, 'primary'>> & {onRetry?: () => void}) {
  return (
    <Panel
      icon={icon}
      title={title}
      body={body}
      tone="danger"
      primary={
        onRetry
          ? {label: 'Try again', onPress: onRetry, icon: 'refresh-cw'}
          : undefined
      }
      {...rest}
    />
  );
}

export function OfflineState({onRetry}: {onRetry?: () => void}) {
  return (
    <Panel
      icon="wifi-off"
      title="You’re offline"
      body="Saved routes and your chosen charger are still available. We’ll refresh when you’re back online."
      tone="warn"
      primary={
        onRetry
          ? {label: 'Retry', onPress: onRetry, icon: 'refresh-cw'}
          : undefined
      }
    />
  );
}

/** Asks for a runtime permission, with a path forward when it was denied. */
export function PermissionPrompt({
  kind,
  denied,
  onAllow,
  onSkip,
  onOpenSettings,
}: {
  kind: 'location' | 'camera' | 'notifications';
  denied?: boolean;
  onAllow: () => void;
  onSkip?: () => void;
  onOpenSettings?: () => void;
}) {
  const copy = {
    location: {
      icon: 'map-pin' as IconName,
      title: denied ? 'Location is off' : 'Find chargers near you',
      body: denied
        ? 'Turn on location in Settings to see chargers around you. You can still search by name or city.'
        : 'PlugOrbit uses your location to find compatible chargers and plan routes. It is never shared with operators.',
    },
    camera: {
      icon: 'camera' as IconName,
      title: denied ? 'Camera access is off' : 'Scan the charger QR',
      body: denied
        ? 'Allow the camera in Settings, or enter the charger ID by hand.'
        : 'We use the camera only to read the QR code on the charger.',
    },
    notifications: {
      icon: 'bell' as IconName,
      title: 'Stay in the loop',
      body: 'Get notified when your charger is ready, at 80%, and if a payment needs attention.',
    },
  }[kind];
  return (
    <Panel
      icon={copy.icon}
      title={copy.title}
      body={copy.body}
      tone={denied ? 'warn' : 'default'}
      primary={
        denied
          ? onOpenSettings
            ? {
                label: 'Open settings',
                onPress: onOpenSettings,
                icon: 'settings',
              }
            : {label: 'Try again', onPress: onAllow, icon: 'refresh-cw'}
          : {label: 'Allow', onPress: onAllow, icon: 'check'}
      }
      secondary={
        onSkip
          ? {label: denied ? 'Continue without' : 'Not now', onPress: onSkip}
          : undefined
      }
      testID={`permission-${kind}`}
    />
  );
}

/** Pulsing placeholder block for loading states. */
export function Skeleton({
  height = 16,
  width = '100%',
  radius = 8,
  style,
}: {
  height?: number;
  width?: number | `${number}%`;
  radius?: number;
  style?: ViewStyle;
}) {
  const pulse = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.45,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View
      style={[
        styles.skeletonBlock,
        {height, width, borderRadius: radius, opacity: pulse},
        style,
      ]}
    />
  );
}

export function CardSkeleton({lines = 3}: {lines?: number}) {
  return (
    <View
      style={[styles.skeletonCard, elevation(1)]}
      accessibilityLabel="Loading"
      accessibilityRole="progressbar">
      <Skeleton height={18} width="55%" />
      {Array.from({length: lines - 1}, (_, i) => (
        <Skeleton
          key={i}
          height={12}
          width={i % 2 ? '70%' : '90%'}
          style={styles.skeletonLine}
        />
      ))}
    </View>
  );
}

export function ListSkeleton({count = 3}: {count?: number}) {
  return (
    <View style={styles.skeletonList}>
      {Array.from({length: count}, (_, i) => (
        <CardSkeleton key={i} />
      ))}
    </View>
  );
}

/** Inline notice (stale data, integration unavailable, ...). */
export function Notice({
  tone = 'info',
  icon,
  title,
  body,
  action,
}: {
  tone?: 'info' | 'warn' | 'danger' | 'lime';
  icon?: IconName;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  const palette = {
    info: {bg: colors.infoSoft, fg: colors.info, icon: 'info' as IconName},
    warn: {
      bg: colors.amberSoft,
      fg: colors.amber,
      icon: 'triangle-alert' as IconName,
    },
    danger: {
      bg: colors.dangerSoft,
      fg: colors.danger,
      icon: 'circle-alert' as IconName,
    },
    lime: {
      bg: colors.limeSoft,
      fg: colors.limeDark,
      icon: 'circle-check' as IconName,
    },
  }[tone];
  return (
    <View
      style={[styles.notice, {backgroundColor: palette.bg}]}
      accessibilityRole="alert">
      <Icon name={icon ?? palette.icon} size={18} color={palette.fg} />
      <View style={styles.noticeText}>
        <Text style={[styles.noticeTitle, {color: palette.fg}]}>{title}</Text>
        {body ? <Text style={styles.noticeBody}>{body}</Text> : null}
        {action}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: 10,
    backgroundColor: colors.amberSoft,
  },
  offlineText: {...type.label, color: colors.amber, flex: 1},
  panel: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  panelCompact: {paddingVertical: spacing.lg},
  panelIcon: {
    width: 64,
    height: 64,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  panelTitle: {...type.h1, color: colors.ink, textAlign: 'center'},
  panelBody: {
    ...type.body,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  panelBtn: {alignSelf: 'stretch', marginTop: spacing.lg},
  skeletonCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  skeletonLine: {marginTop: spacing.sm},
  skeletonBlock: {backgroundColor: '#D9E0E8'},
  skeletonBlock: {backgroundColor: '#D9E0E8'},
  skeletonList: {gap: spacing.md},
  notice: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    alignItems: 'flex-start',
  },
  noticeText: {flex: 1, gap: 2},
  noticeTitle: {...type.label},
  noticeBody: {...type.caption, color: colors.inkSoft},
});
