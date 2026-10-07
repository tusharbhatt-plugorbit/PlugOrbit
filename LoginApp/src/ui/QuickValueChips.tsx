import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {colors, radii, sizes, spacing, type} from '../theme';

/**
 * A single row of equal-width preset values ("20% 40% 60% 80% 100%") that never
 * wraps, unlike a row of `Chip`s. Same pill look as Chip; selected = lime.
 */
export function QuickValueChips({
  values,
  value,
  onSelect,
  format = v => `${v}`,
  label,
}: {
  values: readonly number[];
  value: number;
  onSelect: (v: number) => void;
  format?: (v: number) => string;
  /** Accessibility group label, e.g. "Quick battery levels". */
  label: string;
}) {
  return (
    <View style={styles.row} accessibilityLabel={label}>
      {values.map(v => {
        const selected = v === value;
        return (
          <Pressable
            key={v}
            onPress={() => onSelect(v)}
            accessibilityRole="button"
            accessibilityLabel={`Set ${format(v)}`}
            accessibilityState={{selected}}
            style={({pressed}) => [
              styles.chip,
              selected && styles.selected,
              pressed && styles.pressed,
            ]}>
            <Text style={[styles.text, selected && styles.textSelected]}>
              {format(v)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', gap: spacing.sm},
  chip: {
    flex: 1,
    height: sizes.chip,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selected: {backgroundColor: colors.lime, borderColor: colors.lime},
  pressed: {opacity: 0.85},
  text: {...type.label, color: colors.inkSoft, fontWeight: '600'},
  textSelected: {color: colors.ink, fontWeight: '800'},
});
