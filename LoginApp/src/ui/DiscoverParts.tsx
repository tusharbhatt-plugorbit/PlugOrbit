import React from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {AMENITY_LABEL} from '../domain/discover';
import type {Amenity} from '../domain/types';
import {
  colors,
  elevation,
  radii,
  sizes,
  slopFor,
  spacing,
  type,
} from '../theme';
import {Pill} from './Badges';
import {Icon, IconName} from './Icon';

/** Amenity -> icon, from the generated icon set. */
export const AMENITY_ICON: Record<Amenity, IconName> = {
  restroom: 'toilet',
  cafe: 'coffee',
  food: 'utensils',
  shopping: 'shopping-bag',
  parking: 'circle-parking',
  wifi: 'wifi',
  lounge: 'bed',
  shade: 'sun',
};

export function AmenityPills({
  amenities,
}: {
  amenities: readonly Amenity[];
}): React.JSX.Element {
  return (
    <View style={styles.pills}>
      {amenities.map(a => (
        <Pill key={a} label={AMENITY_LABEL[a]} icon={AMENITY_ICON[a]} />
      ))}
    </View>
  );
}

/**
 * Quick filter chips for the dark header. Same look as Home's chips (dark
 * outline, lime when selected) so the list feels like the same screen family.
 */
export function HeaderChipRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{value: T; label: string}>;
  value: T;
  onChange: (v: T) => void;
}): React.JSX.Element {
  return (
    <ScrollView
      horizontal
      // A horizontal ScrollView otherwise grows to fill the column vertically.
      style={styles.chipScroll}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipRow}
      keyboardShouldPersistTaps="handled">
      {options.map(o => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityLabel={o.label}
            accessibilityState={{selected: active}}
            hitSlop={slopFor(sizes.chip)}
            style={({pressed}) => [
              styles.chip,
              active && styles.chipActive,
              pressed && !active && styles.chipPressed,
            ]}>
            <Text style={[styles.chipText, active && styles.chipTextActive]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Square filters button that sits beside the search field in the header. */
export function HeaderFilterButton({
  count,
  onPress,
}: {
  count: number;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `Filters, ${count} active` : 'Filters'}
      style={({pressed}) => [
        styles.filterBtn,
        count > 0 && styles.filterBtnActive,
        pressed && styles.pressed,
      ]}>
      <Icon
        name="sliders-horizontal"
        size={20}
        color={count > 0 ? colors.ink : '#FFFFFF'}
      />
      {count > 0 && (
        <View style={styles.filterBadge}>
          <Text style={styles.filterBadgeText}>{count}</Text>
        </View>
      )}
    </Pressable>
  );
}

/** A tick/alert line used for "why we recommend it" style lists. */
export function CheckRow({
  text,
  tone = 'good',
}: {
  text: string;
  tone?: 'good' | 'warn';
}): React.JSX.Element {
  const good = tone === 'good';
  return (
    <View style={styles.checkRow}>
      <View
        style={[
          styles.checkIcon,
          {backgroundColor: good ? colors.limeSoft : colors.amberSoft},
        ]}>
        <Icon
          name={good ? 'check' : 'info'}
          size={14}
          color={good ? colors.limeDark : colors.amber}
          strokeWidth={2.6}
        />
      </View>
      <Text style={styles.checkText}>{text}</Text>
    </View>
  );
}

/** Label over value, used for the three hero stats. */
export function StatBlock({
  label,
  value,
  sub,
  onDark = false,
}: {
  label: string;
  value: string;
  sub?: string;
  onDark?: boolean;
}): React.JSX.Element {
  return (
    <View
      style={styles.stat}
      accessible
      accessibilityLabel={`${label}: ${value}${sub ? `, ${sub}` : ''}`}>
      <Text style={[styles.statLabel, onDark && styles.statLabelDark]}>
        {label}
      </Text>
      <Text style={[styles.statValue, onDark && styles.statValueDark]}>
        {value}
      </Text>
      {sub ? (
        <Text style={[styles.statSub, onDark && styles.statSubDark]}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pills: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
  chipScroll: {flexGrow: 0},
  chipRow: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    gap: 10,
  },
  chip: {
    paddingHorizontal: 18,
    height: sizes.chip,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: {backgroundColor: colors.lime, borderColor: colors.lime},
  chipPressed: {backgroundColor: colors.bgRaised},
  chipText: {color: colors.chipText, fontSize: 14, fontWeight: '600'},
  chipTextActive: {color: colors.ink, fontWeight: '800'},
  pressed: {opacity: 0.85},
  filterBtn: {
    width: sizes.field,
    height: sizes.field,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    backgroundColor: colors.bgRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBtnActive: {backgroundColor: colors.lime, borderColor: colors.lime},
  filterBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation(1),
  },
  filterBadgeText: {...type.micro, color: colors.ink},
  checkRow: {flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md},
  checkIcon: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkText: {...type.body, color: colors.inkSoft, flex: 1, lineHeight: 20},
  stat: {flex: 1, gap: 2},
  statLabel: {...type.micro, color: colors.muted, textTransform: 'uppercase'},
  statLabelDark: {color: colors.placeholder},
  statValue: {...type.heading, color: colors.ink, marginTop: 2},
  statValueDark: {color: '#FFFFFF'},
  statSub: {...type.caption, color: colors.muted},
  statSubDark: {color: colors.placeholder},
});
