import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {TRUST_LABEL, dataTrust, isStale, timeAgo} from '../domain/trust';
import type {
  Confidence,
  ConnectorStatus,
  ConnectorType,
  FeedInfo,
  StationConnector,
  TrustLevel,
} from '../domain/types';
import {CONFIDENCE_LABEL, connectorStatusLabel} from '../domain/rules';
import {colors, radii, slopFor, spacing, type} from '../theme';
import {Icon, IconName} from './Icon';

type Tone = 'lime' | 'amber' | 'info' | 'slate' | 'danger' | 'dark';

const TONE: Record<Tone, {bg: string; fg: string}> = {
  lime: {bg: colors.limeSoft, fg: colors.limeDark},
  amber: {bg: colors.amberSoft, fg: colors.amber},
  info: {bg: colors.infoSoft, fg: colors.info},
  slate: {bg: colors.slateSoft, fg: colors.inkSoft},
  danger: {bg: colors.dangerSoft, fg: colors.danger},
  dark: {bg: colors.bg, fg: colors.lime},
};

export function Pill({
  label,
  tone = 'slate',
  icon,
  dot,
  uppercase = false,
}: {
  label: string;
  tone?: Tone;
  icon?: IconName;
  dot?: boolean;
  uppercase?: boolean;
}) {
  const t = TONE[tone];
  return (
    <View style={[styles.pill, {backgroundColor: t.bg}]}>
      {dot && <View style={[styles.dot, {backgroundColor: t.fg}]} />}
      {icon && <Icon name={icon} size={12} color={t.fg} strokeWidth={2.4} />}
      <Text style={[styles.pillText, {color: t.fg}]} numberOfLines={1}>
        {uppercase ? label.toUpperCase() : label}
      </Text>
    </View>
  );
}

const STATUS_TONE: Record<ConnectorStatus, Tone> = {
  available: 'lime',
  occupied: 'amber',
  offline: 'danger',
  reserved: 'info',
  unknown: 'slate',
};

export function StatusBadge({status}: {status: ConnectorStatus}) {
  return (
    <Pill
      label={connectorStatusLabel(status)}
      tone={STATUS_TONE[status]}
      dot
      uppercase
    />
  );
}

const TRUST_TONE: Record<TrustLevel, Tone> = {
  live: 'lime',
  estimated: 'amber',
  user: 'info',
  unknown: 'slate',
};

/**
 * The one component allowed to print LIVE. It derives the label from the feed
 * itself, so a screen cannot claim LIVE for data that isn't.
 */
export function ConfidenceBadge({
  feed,
  now,
  subject,
  showAge = true,
}: {
  feed: FeedInfo;
  now: number;
  /** e.g. "Status" / "Price" for the accessibility label. */
  subject?: string;
  showAge?: boolean;
}) {
  const trust = dataTrust(feed, now);
  const stale = isStale(feed, now);
  const age = timeAgo(feed.updatedAt, now);
  const label =
    trust === 'unknown'
      ? 'Unknown'
      : showAge
      ? `${TRUST_LABEL[trust]} • ${age}`
      : TRUST_LABEL[trust];
  return (
    <View
      style={styles.trustRow}
      accessible
      accessibilityLabel={`${subject ? `${subject}: ` : ''}${
        TRUST_LABEL[trust]
      }${trust === 'unknown' ? '' : `, updated ${age}`}${
        stale && trust !== 'unknown' ? ', stale' : ''
      }`}>
      <Pill label={label} tone={TRUST_TONE[trust]} dot={trust === 'live'} />
      {stale && trust !== 'unknown' && (
        <Pill label="Stale" tone="amber" icon="clock" />
      )}
    </View>
  );
}

export function ConfidencePill({confidence}: {confidence: Confidence}) {
  const tone: Tone =
    confidence === 'high' ? 'lime' : confidence === 'medium' ? 'info' : 'slate';
  return <Pill label={CONFIDENCE_LABEL[confidence]} tone={tone} />;
}

export function ConnectorChip({
  connector,
  selected,
  onPress,
  compatible = true,
}: {
  connector: Pick<StationConnector, 'label' | 'type' | 'powerKw' | 'status'>;
  selected?: boolean;
  onPress?: () => void;
  compatible?: boolean;
}) {
  const dotColor =
    connector.status === 'available'
      ? colors.limeDark
      : connector.status === 'occupied'
      ? colors.amber
      : connector.status === 'offline'
      ? colors.danger
      : colors.placeholder;
  const body = (
    <View
      style={[
        styles.chip,
        selected && styles.chipSelected,
        !compatible && styles.chipDim,
      ]}>
      <View style={[styles.dot, {backgroundColor: dotColor}]} />
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
        {connector.label} • {connector.type} • {connector.powerKw} kW
      </Text>
    </View>
  );
  if (!onPress) {
    return body;
  }
  return (
    <Pressable
      onPress={onPress}
      hitSlop={slopFor(40)}
      accessibilityRole="button"
      accessibilityState={{selected: !!selected}}
      accessibilityLabel={`${connector.label}, ${connector.type}, ${
        connector.powerKw
      } kilowatts, ${connectorStatusLabel(connector.status)}`}>
      {body}
    </Pressable>
  );
}

export function typeLabel(t: ConnectorType): string {
  return t === 'Type2' ? 'Type 2 (AC)' : t === 'GBT' ? 'GB/T' : t;
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    paddingHorizontal: 9,
    height: 24,
    borderRadius: radii.sm,
  },
  pillText: {...type.micro, fontSize: 10.5},
  dot: {width: 7, height: 7, borderRadius: 4},
  trustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.md,
    minHeight: 40,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
  },
  chipSelected: {borderColor: colors.bg, backgroundColor: colors.limeSoft},
  chipDim: {opacity: 0.55},
  chipText: {...type.label, color: colors.ink},
  chipTextSelected: {color: colors.ink},
});
