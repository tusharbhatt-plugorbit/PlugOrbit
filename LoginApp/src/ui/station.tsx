import React, {useEffect, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {
  availableCount,
  compatibleConnectors,
  isCompatible,
  hasPriceRange,
  hasRating,
  hasUnconfirmedConnectors,
  lowestPrice,
  maxPowerKw,
  stationHealth,
  StationHealth,
} from '../domain/rules';
import {priceAgeLabel} from '../domain/trust';
import type {StationWithDistance, Vehicle} from '../domain/types';
import {colors, elevation, radii, spacing, type} from '../theme';
import {formatDistance} from '../utils/geo';
import {formatInr} from '../utils/format';
import {Pill, StatusBadge, ConfidenceBadge} from './Badges';
import {PrimaryButton, TextButton} from './Buttons';
import {Card} from './Card';
import {Icon} from './Icon';

const HEALTH_TO_STATUS = {
  available: 'available',
  busy: 'occupied',
  offline: 'offline',
  unknown: 'unknown',
} as const;

export function healthBadge(health: StationHealth) {
  return <StatusBadge status={HEALTH_TO_STATUS[health]} />;
}

export const UNCONFIRMED_CONNECTORS = 'Connector type unconfirmed';

/** Shown instead of "compatible" when the source doesn't list the connectors. */
export function UnconfirmedConnectorsPill() {
  return (
    <Pill label={UNCONFIRMED_CONNECTORS} tone="amber" icon="triangle-alert" />
  );
}

/** "CCS2 • 60 kW • ₹18/kWh" for the connectors this car can actually use. */
export function connectorSummary(
  s: StationWithDistance,
  vehicle: Vehicle | null,
): string {
  if (hasUnconfirmedConnectors(s)) {
    return UNCONFIRMED_CONNECTORS;
  }
  const usable = compatibleConnectors(s, vehicle);
  const list = usable.length > 0 ? usable : s.connectors;
  const types = [...new Set(list.map(c => c.type))].join(' / ');
  const kw = maxPowerKw(s, vehicle);
  const price = lowestPrice(s, vehicle);
  return `${types} • ${kw} kW • ${
    price === null
      ? 'Price n/a'
      : `${hasPriceRange(s, vehicle) ? 'from ' : ''}${formatInr(
          price,
          price % 1 !== 0,
        )}/kWh`
  }`;
}

export function PriceLine({
  station,
  vehicle,
  now,
}: {
  station: StationWithDistance;
  vehicle: Vehicle | null;
  now: number;
}) {
  const price = lowestPrice(station, vehicle);
  if (price === null) {
    return (
      <Text style={styles.caption}>Price not published by the operator</Text>
    );
  }
  return (
    <Text style={styles.caption}>{priceAgeLabel(station.priceFeed, now)}</Text>
  );
}

/** False when we cannot honestly say how many bays are free. */
function knowsAvailability(
  station: StationWithDistance,
  vehicle: Vehicle | null,
): boolean {
  return (
    !hasUnconfirmedConnectors(station) &&
    stationHealth(station, vehicle) !== 'unknown'
  );
}

/**
 * "2 of 3 free", or nothing when the source cannot say (no plug list, every
 * bay of unknown status, or no plug this car can use): an unknown must never
 * read as "0 free".
 */
function availabilityText(
  station: StationWithDistance,
  vehicle: Vehicle | null,
): string {
  if (!knowsAvailability(station, vehicle)) {
    return '';
  }
  const total = compatibleConnectors(station, vehicle).length;
  return `${availableCount(station, vehicle)} of ${total} free`;
}

function Fact({
  value,
  unit,
  label,
}: {
  value: string;
  unit?: string;
  label: string;
}) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factValue} numberOfLines={1}>
        {value}
        {unit ? <Text style={styles.factUnit}>{unit}</Text> : null}
      </Text>
      <Text style={styles.factLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/**
 * The numbers a driver scans: speed (with the plug it is on), price and how
 * reliable the charger is. Reliability is left out when nobody has measured it
 * rather than shown as 0%.
 */
export function StationFacts({
  station,
  vehicle,
}: {
  station: StationWithDistance;
  vehicle: Vehicle | null;
}) {
  if (hasUnconfirmedConnectors(station)) {
    return <UnconfirmedConnectorsPill />;
  }
  const usable = compatibleConnectors(station, vehicle);
  const types = [
    ...new Set(
      (usable.length > 0 ? usable : station.connectors).map(c => c.type),
    ),
  ].join(' / ');
  const price = lowestPrice(station, vehicle);
  const range = hasPriceRange(station, vehicle);
  return (
    <View style={styles.facts}>
      <Fact
        value={String(maxPowerKw(station, vehicle))}
        unit=" kW"
        label={types}
      />
      <Fact
        value={price === null ? '—' : formatInr(price, price % 1 !== 0)}
        unit={price === null ? undefined : '/kWh'}
        label={range ? 'Price from' : 'Price'}
      />
      {station.reliabilityPct > 0 && (
        <Fact
          value={`${Math.round(station.reliabilityPct)}%`}
          label="Reliable"
        />
      )}
    </View>
  );
}

type CardProps = {
  station: StationWithDistance;
  vehicle: Vehicle | null;
  now: number;
  onPress?: () => void;
  /** Visual state for compare-selection. */
  selected?: boolean;
  favourite?: boolean;
  onToggleFavourite?: () => void;
  recommended?: boolean;
  testID?: string;
};

/** List item for Nearby chargers, Compare, Saved. */
export const ChargerCard = React.memo(function ChargerCardInner({
  station,
  vehicle,
  now,
  onPress,
  selected,
  favourite,
  onToggleFavourite,
  recommended,
  testID,
}: CardProps) {
  const health = stationHealth(station, vehicle);
  const free = availableCount(station, vehicle);
  const compatible = isCompatible(station, vehicle);
  const unconfirmed = hasUnconfirmedConnectors(station);
  return (
    <Card
      onPress={onPress}
      tone={recommended || selected ? 'lime' : 'default'}
      accessibilityLabel={`${station.name}, ${station.distanceKm.toFixed(
        1,
      )} kilometres, ${
        unconfirmed
          ? 'connector type unconfirmed'
          : knowsAvailability(station, vehicle)
          ? `${free} bays free`
          : 'availability unknown'
      }`}
      testID={testID}
      style={selected ? styles.selected : undefined}>
      <View style={styles.topRow}>
        <View style={styles.titleCol}>
          {recommended && <Text style={styles.recommended}>Best nearby</Text>}
          <Text style={styles.name} numberOfLines={2}>
            {station.name}
          </Text>
        </View>
        <Icon name="chevron-right" size={20} color={colors.placeholder} />
      </View>
      <View style={styles.statusRow}>
        {healthBadge(health)}
        <Text style={styles.availability} numberOfLines={1}>
          {availabilityText(station, vehicle)}
        </Text>
        <Text style={styles.distance}>
          {formatDistance(station.distanceKm)}
        </Text>
      </View>
      <StationFacts station={station} vehicle={vehicle} />
      <Text style={[styles.line, styles.detour]}>
        {station.detourMin} min detour
        {hasRating(station) ? ` • ★ ${station.rating.toFixed(1)}` : ''}
      </Text>
      <View style={styles.trustRow}>
        <ConfidenceBadge feed={station.statusFeed} now={now} subject="Status" />
        {station.sponsored && <Pill label="Sponsored" tone="slate" />}
        {!unconfirmed && !compatible && (
          <Pill label="Not compatible" tone="danger" icon="triangle-alert" />
        )}
        {station.integration === 'external' && (
          <Pill label="Operator app" tone="slate" icon="smartphone" />
        )}
      </View>
      <View style={styles.footRow}>
        <PriceLine station={station} vehicle={vehicle} now={now} />
        {onToggleFavourite && (
          <Pressable
            onPress={onToggleFavourite}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={
              favourite ? 'Remove from saved' : 'Save station'
            }
            accessibilityState={{selected: !!favourite}}>
            <Icon
              name="heart"
              size={20}
              color={favourite ? colors.danger : colors.placeholder}
              filled={favourite}
            />
          </Pressable>
        )}
      </View>
    </Card>
  );
});

type MapCardProps = {
  station: StationWithDistance;
  vehicle: Vehicle | null;
  now: number;
  onClose: () => void;
  onDetails: () => void;
  onDirections: () => void;
  bottom: number;
  best?: boolean;
};

/** The approved Home map card: thumb, name, meta lines, price, dark Directions CTA. */
export function MapChargerCard({
  station,
  vehicle,
  now,
  onClose,
  onDetails,
  onDirections,
  bottom,
  best,
}: MapCardProps) {
  const health = stationHealth(station, vehicle);
  // Collapsed it leaves the map visible: name, status (with how fresh it is) and
  // the Directions action. Expanded adds the figures behind them.
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [station.id]);
  return (
    <View style={[styles.mapCard, elevation(3), {bottom}]} testID="map-card">
      <Pressable
        onPress={onDetails}
        accessibilityRole="button"
        accessibilityLabel={`View ${station.name}`}>
        {best && <Text style={styles.recommended}>Best nearby</Text>}
        <Text style={styles.mapTitle} numberOfLines={2}>
          {station.name}
        </Text>
        <View style={styles.statusRow}>
          {healthBadge(health)}
          <Text style={styles.availability} numberOfLines={1}>
            {availabilityText(station, vehicle)}
          </Text>
          <Text style={styles.distance}>
            {formatDistance(station.distanceKm)}
          </Text>
        </View>
        {expanded && <StationFacts station={station} vehicle={vehicle} />}
      </Pressable>
      <Pressable
        onPress={() => setExpanded(e => !e)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={
          expanded ? 'Show fewer details' : 'Show more details'
        }
        accessibilityState={{expanded}}
        testID="map-card-toggle"
        style={[styles.close, styles.toggle]}>
        <Icon
          name={expanded ? 'chevron-down' : 'chevron-up'}
          size={16}
          color={colors.ink}
        />
      </Pressable>
      <Pressable
        onPress={onClose}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Close details"
        style={styles.close}>
        <Icon name="x" size={14} color={colors.ink} />
      </Pressable>
      <View style={styles.mapTrust}>
        <ConfidenceBadge feed={station.statusFeed} now={now} subject="Status" />
      </View>
      {expanded && (
        <>
          <PriceLine station={station} vehicle={vehicle} now={now} />
          <TextButton label="View full details" onPress={onDetails} />
        </>
      )}
      <PrimaryButton
        label="Directions"
        icon="navigation"
        onPress={onDirections}
        style={styles.cta}
      />
    </View>
  );
}

export function ReliabilityBar({
  successPct,
  label = 'successful sessions',
}: {
  successPct: number;
  label?: string;
}) {
  const tone =
    successPct >= 90
      ? colors.limeDark
      : successPct >= 80
      ? colors.amber
      : colors.danger;
  return (
    <View
      accessible
      accessibilityLabel={`${Math.round(successPct)} percent ${label}`}
      style={styles.rel}>
      <View style={styles.relHead}>
        <Text style={styles.relValue}>{Math.round(successPct)}%</Text>
        <Text style={styles.relLabel}>{label}</Text>
      </View>
      <View style={styles.relTrack}>
        <View
          style={[
            styles.relFill,
            {width: `${Math.min(100, successPct)}%`, backgroundColor: tone},
          ]}
        />
      </View>
    </View>
  );
}

/** Backup for a recommended stop: always shown beside the primary choice. */
export function BackupChargerCard({
  station,
  vehicle,
  now,
  extraMin,
  onPress,
  title = 'Backup',
}: {
  station: StationWithDistance;
  vehicle: Vehicle | null;
  now: number;
  extraMin: number;
  onPress?: () => void;
  title?: string;
}) {
  const health = stationHealth(station, vehicle);
  return (
    <Card
      onPress={onPress}
      accessibilityLabel={`${title}: ${station.name}, plus ${extraMin} minutes`}>
      <View style={styles.backupHead}>
        <View style={styles.backupIcon}>
          <Icon name="shield-check" size={18} color={colors.info} />
        </View>
        <Text style={styles.backupTitle}>{title}</Text>
        <Pill label={`+${extraMin} min`} tone="info" />
      </View>
      <View style={styles.topRow}>
        <Text style={[styles.name, styles.flex]} numberOfLines={1}>
          {station.name}
        </Text>
        {healthBadge(health)}
      </View>
      <Text style={styles.line}>{connectorSummary(station, vehicle)}</Text>
      <View style={styles.trustRow}>
        <ConfidenceBadge
          feed={station.statusFeed}
          now={now}
          subject="Backup status"
        />
      </View>
      <View style={styles.priceRow}>
        <PriceLine station={station} vehicle={vehicle} now={now} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  titleCol: {flex: 1},
  recommended: {
    ...type.micro,
    color: colors.limeDark,
    marginBottom: 3,
    textTransform: 'uppercase',
  },
  name: {...type.heading, color: colors.ink},
  line: {...type.caption, color: colors.inkSoft, marginTop: 4},
  detour: {marginTop: spacing.md},
  caption: {...type.caption, color: colors.muted, fontSize: 12},
  trustRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
  },
  priceRow: {marginTop: spacing.xs},
  footRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  selected: {borderWidth: 2, borderColor: colors.bg},
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  availability: {...type.label, color: colors.inkSoft, flex: 1},
  distance: {...type.heading, color: colors.ink},
  facts: {
    flexDirection: 'row',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  fact: {flex: 1},
  factValue: {...type.heading, color: colors.ink},
  factUnit: {...type.caption, color: colors.muted, fontWeight: '600'},
  factLabel: {
    ...type.caption,
    color: colors.muted,
    fontSize: 11.5,
    marginTop: 2,
  },
  mapCard: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  mapTitle: {...type.heading, color: colors.ink, paddingRight: 80},
  close: {
    position: 'absolute',
    top: spacing.lg,
    right: spacing.lg,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Sits left of the close button; each keeps a 44px touch area through hitSlop.
  toggle: {right: spacing.lg + 28 + 12},
  mapTrust: {marginTop: spacing.md, marginBottom: 2},
  cta: {marginTop: spacing.md},
  rel: {gap: 6},
  relHead: {flexDirection: 'row', alignItems: 'baseline', gap: 6},
  relValue: {...type.h1, color: colors.ink},
  relLabel: {...type.caption, color: colors.muted},
  relTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.slateSoft,
    overflow: 'hidden',
  },
  relFill: {height: '100%', borderRadius: 4},
  backupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  backupIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: colors.infoSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backupTitle: {...type.label, color: colors.info, flex: 1},
});
