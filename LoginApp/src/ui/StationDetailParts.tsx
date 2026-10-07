import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {whyRecommended} from '../domain/discover';
import {
  availableCount,
  compatibleConnectors,
  effectivePowerKw,
  hasRating,
  hasUnconfirmedConnectors,
  stationHealth,
} from '../domain/rules';
import type {
  StationConnector,
  StationWithDistance,
  Vehicle,
} from '../domain/types';
import {colors, radii, spacing, type} from '../theme';
import {formatDistance} from '../utils/geo';
import {formatDuration, formatInr} from '../utils/format';
import {ConfidenceBadge, Pill, StatusBadge, typeLabel} from './Badges';
import {Card, KeyValue} from './Card';
import {CheckRow, StatBlock} from './DiscoverParts';
import {Icon} from './Icon';
import {
  PriceLine,
  ReliabilityBar,
  UnconfirmedConnectorsPill,
  healthBadge,
} from './station';
import {vehicleName} from './session';

// Beyond this a "detour" is really a drive, so say so.
const NEAR_DETOUR_KM = 25;

/** The hero of Station detail: identity, trust, and the three numbers that matter. */
export function StationHero({
  station,
  vehicle,
  now,
  favourite,
  onToggleFavourite,
}: {
  station: StationWithDistance;
  vehicle: Vehicle | null;
  now: number;
  favourite: boolean;
  onToggleFavourite: () => void;
}): React.JSX.Element {
  const health = stationHealth(station, vehicle);
  const usable = compatibleConnectors(station, vehicle);
  const free = availableCount(station, vehicle);
  const unconfirmed = hasUnconfirmedConnectors(station);
  return (
    <Card tone="dark" style={styles.hero} testID="station-hero">
      <View style={styles.heroTop}>
        <View style={styles.heroTile}>
          <Icon name="zap" size={24} color={colors.lime} filled />
        </View>
        <View style={styles.flex}>
          <Text style={styles.heroName} accessibilityRole="header">
            {station.name}
          </Text>
          <Text style={styles.heroSub} numberOfLines={2}>
            {station.operator}
            {station.address ? ` • ${station.address}` : ''}
          </Text>
        </View>
        <Pressable
          onPress={onToggleFavourite}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={favourite ? 'Remove from saved' : 'Save station'}
          accessibilityState={{selected: favourite}}
          style={styles.heart}>
          <Icon
            name="heart"
            size={20}
            color={favourite ? colors.danger : '#FFFFFF'}
            filled={favourite}
          />
        </Pressable>
      </View>

      <View style={styles.heroTrust}>
        {usable.length > 0 ? (
          healthBadge(health)
        ) : unconfirmed ? (
          <UnconfirmedConnectorsPill />
        ) : (
          <Pill label="Not compatible" tone="danger" icon="triangle-alert" />
        )}
        <ConfidenceBadge feed={station.statusFeed} now={now} subject="Status" />
        {station.sponsored && <Pill label="Sponsored" tone="slate" />}
        {station.integration === 'external' && (
          <Pill label="Operator app" tone="slate" icon="smartphone" />
        )}
      </View>

      <View style={styles.heroDivider} />

      <View style={styles.heroStats}>
        <StatBlock
          onDark
          label="Distance"
          value={formatDistance(station.distanceKm)}
          sub={
            station.distanceKm <= NEAR_DETOUR_KM
              ? `${station.detourMin} min detour`
              : `~${formatDuration(station.detourMin)} drive`
          }
        />
        <StatBlock
          onDark
          label="Bays free"
          value={
            usable.length > 0
              ? `${free} of ${usable.length}`
              : unconfirmed
              ? 'Unknown'
              : 'None fit'
          }
          sub={unconfirmed ? 'connectors unconfirmed' : 'compatible'}
        />
        <StatBlock
          onDark
          label="Rating"
          value={
            hasRating(station) ? `★ ${station.rating.toFixed(1)}` : 'Not rated'
          }
          sub={hasRating(station) ? 'driver rating' : 'no ratings yet'}
        />
      </View>

      <View style={styles.heroHours}>
        <Icon name="clock" size={14} color={colors.placeholder} />
        <Text style={styles.heroHoursText}>{station.hours}</Text>
      </View>
    </Card>
  );
}

/** Details for the connector the driver selected: status, speed, price and ages. */
export function ConnectorPanel({
  station,
  vehicle,
  connector,
  now,
}: {
  station: StationWithDistance;
  vehicle: Vehicle | null;
  connector: StationConnector;
  now: number;
}): React.JSX.Element {
  const carKw = effectivePowerKw(connector, vehicle);
  const price = connector.pricePerKwh;
  return (
    <Card testID="connector-panel">
      <View style={styles.panelHead}>
        <Text style={styles.panelTitle}>
          {connector.label} • {typeLabel(connector.type)}
        </Text>
        <StatusBadge status={connector.status} />
      </View>
      <View style={styles.panelTrust}>
        <ConfidenceBadge
          feed={station.statusFeed}
          now={now}
          subject={`Connector ${connector.label} status`}
        />
      </View>
      <KeyValue label="Charger power" value={`${connector.powerKw} kW`} />
      {vehicle && carKw < connector.powerKw && (
        <KeyValue
          label={`Your ${vehicle.model} draws`}
          value={`up to ${carKw} kW`}
        />
      )}
      <KeyValue
        label="Price"
        value={
          price === null
            ? 'Not published'
            : `${formatInr(price, price % 1 !== 0)}/kWh`
        }
        emphasis={price !== null}
        last={connector.idleFeePerMin === null}
      />
      {connector.idleFeePerMin !== null && (
        <KeyValue
          label="Idle fee"
          value={`₹${connector.idleFeePerMin}/min after charging`}
          last
        />
      )}
      <PriceLine station={station} vehicle={vehicle} now={now} />
    </Card>
  );
}

/** What PlugOrbit can and cannot do at a charger run by someone else. */
export function OperatorInstructionsCard({
  station,
}: {
  station: StationWithDistance;
}): React.JSX.Element {
  return (
    <Card tone="warn" testID="operator-instructions">
      <View style={styles.opHead}>
        <View style={styles.opIcon}>
          <Icon name="smartphone" size={20} color={colors.amber} />
        </View>
        <Text style={styles.opTitle}>Start and pay with the operator</Text>
      </View>
      <Text style={styles.opBody}>
        {station.operatorInstructions ??
          'Use the operator’s own app or the QR code on the charger to start and pay.'}
      </Text>
      <Text style={styles.opNote}>
        PlugOrbit can’t start, stop or bill this charger, so there is no remote
        start here.
      </Text>
    </Card>
  );
}

/** "Why we recommend it": reasons derived from the data, caveats, reliability. */
export function ReasonsCard({
  station,
  vehicle,
  now,
}: {
  station: StationWithDistance;
  vehicle: Vehicle | null;
  now: number;
}): React.JSX.Element {
  const why = whyRecommended(station, vehicle, now);
  return (
    <Card testID="why-card">
      {why.reasons.length > 0 ? (
        <View style={styles.reasons}>
          {why.reasons.map(r => (
            <CheckRow key={r} text={r} />
          ))}
        </View>
      ) : (
        <Text style={styles.noReasons}>
          Nothing stands out for {vehicle ? vehicleName(vehicle) : 'your car'}{' '}
          here yet. Check the backup below before you go.
        </Text>
      )}
      {why.caveats.length > 0 && (
        <View style={[styles.reasons, styles.caveats]}>
          {why.caveats.map(c => (
            <CheckRow key={c} text={c} tone="warn" />
          ))}
        </View>
      )}
      <View style={styles.relWrap}>
        {station.successfulSessionsPct > 0 ? (
          <ReliabilityBar
            successPct={station.successfulSessionsPct}
            label="successful sessions"
          />
        ) : (
          <Text style={styles.noReasons}>
            No session history yet, so we can’t show a reliability score.
          </Text>
        )}
        <Text style={styles.relNote}>
          Sponsorship never changes reliability or ranking.
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  hero: {gap: spacing.md, padding: spacing.lg + 2},
  heroTop: {flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md},
  heroTile: {
    width: 48,
    height: 48,
    borderRadius: radii.md,
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroName: {...type.h1, color: '#FFFFFF'},
  heroSub: {...type.caption, color: colors.placeholder, marginTop: 2},
  heart: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTrust: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  heroDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.chipBorder,
  },
  heroStats: {flexDirection: 'row', gap: spacing.md},
  heroHours: {flexDirection: 'row', alignItems: 'center', gap: 6},
  heroHoursText: {...type.caption, color: colors.chipText},
  panelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  panelTitle: {...type.heading, color: colors.ink, flex: 1},
  panelTrust: {marginTop: spacing.sm, marginBottom: spacing.xs},
  opHead: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  opIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  opTitle: {...type.heading, color: colors.ink, flex: 1},
  opBody: {
    ...type.body,
    color: colors.inkSoft,
    lineHeight: 21,
    marginTop: spacing.md,
  },
  opNote: {
    ...type.label,
    color: colors.amber,
    marginTop: spacing.md,
    lineHeight: 18,
  },
  reasons: {gap: spacing.md},
  caveats: {
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  noReasons: {...type.body, color: colors.muted, lineHeight: 20},
  relWrap: {
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    gap: spacing.sm,
  },
  relNote: {...type.caption, color: colors.muted},
});
