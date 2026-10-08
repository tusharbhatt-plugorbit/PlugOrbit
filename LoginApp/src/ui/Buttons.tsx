import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import {colors, radii, sizes, spacing, type} from '../theme';
import {Icon, IconName} from './Icon';

type ButtonProps = {
  label: string;
  onPress?: () => void;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  /** Smaller (44) button for inline actions. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityHint?: string;
};

type Variant = 'dark' | 'lime' | 'danger';

const VARIANT: Record<Variant, {bg: string; fg: string; spinner: string}> = {
  // Matches Home's "Directions": dark fill, white label.
  dark: {bg: colors.bg, fg: '#FFFFFF', spinner: '#FFFFFF'},
  // Matches Welcome's primary: lime fill, black label. For dark surfaces.
  lime: {bg: colors.lime, fg: '#000000', spinner: '#000000'},
  danger: {bg: colors.danger, fg: '#FFFFFF', spinner: '#FFFFFF'},
};

export function PrimaryButton({
  label,
  onPress,
  icon,
  loading = false,
  disabled = false,
  compact = false,
  variant = 'dark',
  style,
  testID,
  accessibilityHint,
}: ButtonProps & {variant?: Variant}) {
  const v = VARIANT[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={inactive ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{disabled: inactive, busy: loading}}
      testID={testID}
      android_ripple={{color: 'rgba(255,255,255,0.18)'}}
      style={({pressed}) => [
        styles.base,
        compact && styles.compact,
        {backgroundColor: v.bg},
        disabled && styles.disabled,
        pressed && !inactive && styles.pressed,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={v.spinner} />
      ) : (
        <View style={styles.row}>
          {icon && <Icon name={icon} size={compact ? 16 : 18} color={v.fg} />}
          <Text
            style={[
              styles.label,
              compact && styles.labelCompact,
              {color: v.fg},
            ]}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
  icon,
  loading = false,
  disabled = false,
  compact = false,
  tone = 'default',
  style,
  testID,
  accessibilityHint,
}: ButtonProps & {tone?: 'default' | 'danger'}) {
  const fg = tone === 'danger' ? colors.danger : colors.ink;
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={inactive ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{disabled: inactive, busy: loading}}
      testID={testID}
      android_ripple={{color: 'rgba(15,23,42,0.08)'}}
      style={({pressed}) => [
        styles.base,
        styles.secondary,
        compact && styles.compact,
        disabled && styles.disabled,
        pressed && !inactive && styles.pressed,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.row}>
          {icon && <Icon name={icon} size={compact ? 16 : 18} color={fg} />}
          <Text
            style={[styles.label, compact && styles.labelCompact, {color: fg}]}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

/** Low-emphasis inline action ("Change", "See all"). */
export function TextButton({
  label,
  onPress,
  icon,
  tone = 'default',
  testID,
}: {
  label: string;
  onPress?: () => void;
  icon?: IconName;
  /** `onDark` is for dark surfaces (header, dark cards): the lime accent. */
  tone?: 'default' | 'danger' | 'muted' | 'onDark';
  testID?: string;
}) {
  const fg =
    tone === 'danger'
      ? colors.danger
      : tone === 'muted'
      ? colors.muted
      : tone === 'onDark'
      ? colors.lime
      : colors.limeDark;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={({pressed}) => [styles.textBtn, pressed && styles.pressed]}>
      {icon && <Icon name={icon} size={16} color={fg} />}
      <Text style={[type.label, {color: fg}]}>{label}</Text>
    </Pressable>
  );
}

/** Round icon-only button; always has an accessible label. */
export function IconButton({
  icon,
  label,
  onPress,
  tone = 'light',
  size = sizes.tap,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress?: () => void;
  tone?: 'light' | 'dark' | 'lime';
  size?: number;
  testID?: string;
}) {
  const palette = {
    light: {bg: colors.surface, fg: colors.ink},
    dark: {bg: colors.bgRaised, fg: '#FFFFFF'},
    lime: {bg: colors.lime, fg: colors.ink},
  }[tone];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      hitSlop={6}
      style={({pressed}) => [
        styles.iconBtn,
        {
          width: size,
          height: size,
          borderRadius: size / 2.6,
          backgroundColor: palette.bg,
        },
        pressed && styles.pressed,
      ]}>
      <Icon name={icon} size={Math.round(size * 0.45)} color={palette.fg} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: sizes.button,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    overflow: 'hidden',
  },
  compact: {height: sizes.buttonCompact, paddingHorizontal: spacing.lg},
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
  },
  row: {flexDirection: 'row', alignItems: 'center', gap: 10},
  label: {...type.button},
  labelCompact: {fontSize: 14, fontWeight: '800'},
  disabled: {opacity: 0.45},
  pressed: {opacity: 0.85, transform: [{scale: 0.99}]},
  textBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 32,
    justifyContent: 'center',
  },
  iconBtn: {alignItems: 'center', justifyContent: 'center'},
});
