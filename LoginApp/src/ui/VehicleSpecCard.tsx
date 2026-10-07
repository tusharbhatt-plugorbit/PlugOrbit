import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {Vehicle} from '../domain/types';
import {colors, elevation, radii, spacing, type} from '../theme';
import {Pill, typeLabel} from './Badges';
import {Icon} from './Icon';

/** Anything with a car's technical specs: a catalogue model or a saved vehicle. */
export type VehicleSpecLike = Pick<
  Vehicle,
  | 'make'
  | 'model'
  | 'variant'
  | 'batteryKwh'
  | 'connectors'
  | 'maxDcKw'
  | 'maxAcKw'
  | 'rangeKm100'
>;

function Stat({
  value,
  unit,
  label,
  muted,
}: {
  value: string;
  unit?: string;
  label: string;
  muted?: boolean;
}) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, muted && styles.statMuted]}>
        {value}
        {unit ? <Text style={styles.statUnit}> {unit}</Text> : null}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/**
 * One car: name, battery, connectors and charge limits. With `onPress` it is a
 * radio-style choice (catalogue); without it, a read-only card with a `badge`
 * and `footer` actions (Your vehicles).
 */
export function VehicleSpecCard({
  spec,
  selected = false,
  onPress,
  badge,
  footer,
  testID,
}: {
  spec: VehicleSpecLike;
  selected?: boolean;
  onPress?: () => void;
  /** Right-hand slot, e.g. an "Active" pill. Replaces the radio dot. */
  badge?: React.ReactNode;
  footer?: React.ReactNode;
  testID?: string;
}) {
  const name = `${spec.make} ${spec.model}`;
  const connectors = spec.connectors.map(typeLabel).join(', ');
  const body = (
    <>
      <View style={styles.head}>
        <View style={[styles.tile, selected && styles.tileSelected]}>
          <Icon name="car" size={22} color={colors.ink} />
        </View>
        <View style={styles.headText}>
          <Text style={styles.name} numberOfLines={2}>
            {name}
          </Text>
          <Text style={styles.variant} numberOfLines={1}>
            {spec.variant}
          </Text>
        </View>
        {badge ??
          (onPress ? (
            <View style={[styles.radio, selected && styles.radioOn]}>
              {selected && (
                <Icon
                  name="check"
                  size={14}
                  color={colors.ink}
                  strokeWidth={3}
                />
              )}
            </View>
          ) : null)}
      </View>

      <View style={styles.stats}>
        <Stat value={String(spec.batteryKwh)} unit="kWh" label="Battery" />
        <Stat
          value={spec.maxDcKw > 0 ? String(spec.maxDcKw) : 'None'}
          unit={spec.maxDcKw > 0 ? 'kW' : undefined}
          label="DC max"
          muted={spec.maxDcKw === 0}
        />
        <Stat
          value={spec.maxAcKw > 0 ? String(spec.maxAcKw) : 'None'}
          unit={spec.maxAcKw > 0 ? 'kW' : undefined}
          label="AC max"
          muted={spec.maxAcKw === 0}
        />
        <Stat value={String(spec.rangeKm100)} unit="km" label="Range" />
      </View>

      <View style={styles.connectors}>
        {spec.connectors.map(c => (
          <Pill key={c} label={typeLabel(c)} tone="slate" icon="plug" />
        ))}
      </View>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </>
  );

  const containerStyle = [
    styles.card,
    elevation(1),
    selected && styles.cardSelected,
  ];
  if (!onPress) {
    return (
      <View style={containerStyle} testID={testID}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{selected}}
      accessibilityLabel={`${name}, ${spec.variant}, ${spec.batteryKwh} kilowatt hour battery, connectors ${connectors}`}
      testID={testID}
      style={({pressed}) => [...containerStyle, pressed && styles.pressed]}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  cardSelected: {borderColor: colors.bg, backgroundColor: colors.limeSoft},
  pressed: {opacity: 0.9},
  head: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  tile: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileSelected: {backgroundColor: colors.surface},
  headText: {flex: 1},
  name: {...type.heading, color: colors.ink},
  variant: {...type.caption, color: colors.muted, marginTop: 2},
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
  stats: {
    flexDirection: 'row',
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  stat: {flex: 1},
  statValue: {...type.heading, color: colors.ink},
  statUnit: {...type.caption, color: colors.muted},
  statMuted: {color: colors.placeholder},
  statLabel: {
    ...type.caption,
    color: colors.muted,
    fontSize: 11.5,
    marginTop: 2,
  },
  connectors: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: spacing.md,
  },
  footer: {marginTop: spacing.md},
});
