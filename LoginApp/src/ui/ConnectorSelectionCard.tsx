import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {ConnectorType} from '../domain/types';
import {colors, elevation, radii, spacing, type} from '../theme';
import {ConnectorImage} from './ConnectorImage';
import {Icon} from './Icon';

/** What a driver needs to recognise a plug: its name and whether it is AC or DC. */
export const CONNECTOR_INFO: Record<
  ConnectorType,
  {name: string; kind: string}
> = {
  CCS2: {name: 'CCS2', kind: 'DC fast charging'},
  Type2: {name: 'Type 2', kind: 'AC charging'},
  CHAdeMO: {name: 'CHAdeMO', kind: 'DC fast charging'},
  GBT: {name: 'GB/T', kind: 'DC fast charging'},
  LECCS: {name: 'LECCS', kind: 'DC fast charging'},
};

type Props = {
  type: ConnectorType;
  selected: boolean;
  /** Omit for a read-only display (a catalogue car's fixed connectors). */
  onPress?: () => void;
  testID?: string;
};

/**
 * One connector as a card: picture, name, AC/DC, and an obvious selected state
 * (dark outline, soft lime fill, lime check). Interactive when `onPress` is set.
 */
export function ConnectorSelectionCard({
  type: connector,
  selected,
  onPress,
  testID,
}: Props) {
  const info = CONNECTOR_INFO[connector];
  const body = (
    <>
      <View style={[styles.picture, selected && styles.pictureSelected]}>
        <ConnectorImage
          type={connector}
          size={64}
          pin={selected ? colors.lime : undefined}
        />
      </View>
      <Text style={styles.name}>{info.name}</Text>
      <Text style={styles.kind}>{info.kind}</Text>
      <View
        style={[
          styles.mark,
          selected
            ? styles.markOn
            : onPress
            ? styles.markOff
            : styles.markHidden,
        ]}>
        {selected && (
          <Icon name="check" size={14} color={colors.ink} strokeWidth={3} />
        )}
      </View>
    </>
  );
  const containerStyle = [
    styles.card,
    elevation(1),
    selected && styles.cardSelected,
  ];

  if (!onPress) {
    return (
      <View
        style={containerStyle}
        accessible
        accessibilityLabel={`${info.name}, ${info.kind}`}
        testID={testID}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{checked: selected}}
      accessibilityLabel={`${info.name}, ${info.kind}`}
      testID={testID}
      style={({pressed}) => [...containerStyle, pressed && styles.pressed]}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 130,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.inputBorder,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
  },
  cardSelected: {borderColor: colors.bg, backgroundColor: colors.limeSoft},
  pressed: {opacity: 0.9},
  picture: {
    width: 84,
    height: 84,
    borderRadius: radii.md,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pictureSelected: {backgroundColor: colors.surface},
  name: {...type.heading, color: colors.ink, marginTop: spacing.md},
  kind: {...type.caption, color: colors.muted, marginTop: 2},
  mark: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.inputBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markOn: {backgroundColor: colors.lime, borderColor: colors.lime},
  markOff: {backgroundColor: colors.surface},
  markHidden: {opacity: 0},
});

/** A small connector picture + name, for summaries ("Chargers with ..."). */
export function ConnectorTag({type: connector}: {type: ConnectorType}) {
  return (
    <View style={tagStyles.tag}>
      <ConnectorImage type={connector} size={24} />
      <Text style={tagStyles.text}>{CONNECTOR_INFO[connector].name}</Text>
    </View>
  );
}

const tagStyles = StyleSheet.create({
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 36,
    paddingLeft: spacing.sm,
    paddingRight: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  text: {...type.label, color: colors.ink},
});
