import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {colors, elevation, radii, spacing, type} from '../theme';
import {Icon, IconName} from './Icon';

/**
 * A radio-style option with an icon, a title and a sentence of explanation
 * ("OEM account", "Bluetooth OBD"). Selected = the app's lime-soft card with a
 * dark outline, the same as payment methods.
 */
export function ChoiceCard({
  icon,
  title,
  body,
  selected,
  disabled,
  onPress,
  testID,
}: {
  icon: IconName;
  title: string;
  body: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="radio"
      accessibilityState={{selected, disabled: !!disabled}}
      accessibilityLabel={`${title}. ${body}`}
      testID={testID}
      style={({pressed}) => [
        styles.card,
        elevation(1),
        selected && styles.selected,
        disabled && !selected && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}>
      <View style={[styles.tile, selected && styles.tileSelected]}>
        <Icon name={icon} size={20} color={colors.ink} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
      </View>
      <View style={[styles.radio, selected && styles.radioOn]}>
        {selected && (
          <Icon name="check" size={14} color={colors.ink} strokeWidth={3} />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  selected: {borderColor: colors.bg, backgroundColor: colors.limeSoft},
  disabled: {opacity: 0.55},
  pressed: {opacity: 0.9},
  tile: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileSelected: {backgroundColor: colors.surface},
  text: {flex: 1},
  title: {...type.heading, color: colors.ink},
  body: {...type.caption, color: colors.muted, marginTop: 2, lineHeight: 18},
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.inputBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: {backgroundColor: colors.lime, borderColor: colors.lime},
});
