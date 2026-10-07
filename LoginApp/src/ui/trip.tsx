import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {stopCostLabel} from '../domain/routeCost';
import type {Route, RouteStop, Vehicle} from '../domain/types';
import {colors, radii, spacing, type} from '../theme';
import {formatDurationShort} from '../utils/format';
import {Pill} from './Badges';
import {Card} from './Card';
import {Icon, IconName} from './Icon';
import {BackupChargerCard} from './station';
import {Notice} from './States';

function Stat({
  icon,
  label,
  value,
}: {
  icon: IconName;
  label: string;
  value: string;
}) {
  return (
    <View
      style={styles.stat}
      accessible
      accessibilityLabel={`${label}: ${value}`}>
      <Icon name={icon} size={16} color={colors.muted} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/** From → to header plus the numbers that matter for a trip. */
export function RouteSummary({
  route,
  cachedLabel,
}: {
  route: Route;
  /** e.g. "Saved 12 min ago" when showing a cached plan. */
  cachedLabel?: string;
}) {
  return (
    <Card>
      <View style={styles.head}>
        <Text style={styles.title} numberOfLines={1}>
          {route.fromLabel} → {route.toLabel}
        </Text>
        <Pill
          label={
            route.strategy === 'fastest'
              ? 'Fastest'
              : route.strategy === 'cheapest'
              ? 'Cheapest'
              : 'Most reliable'
          }
          tone="lime"
        />
      </View>
      <View style={styles.stats}>
        <Stat
          icon="map-pin"
          label="Distance"
          value={`${route.distanceKm} km`}
        />
        <Stat
          icon="clock"
          label="Total time"
          value={formatDurationShort(route.driveMin)}
        />
        <Stat
          icon="battery"
          label="Arrive with"
          value={`${route.arriveSoc}%`}
        />
        <Stat
          icon="plug-zap"
          label="Stops"
          value={String(route.stops.length)}
        />
      </View>
      <Text style={styles.reserve}>
        Keeps at least {route.safetyReservePct}% battery in reserve.
        {cachedLabel ? `  ${cachedLabel}` : ''}
      </Text>
    </Card>
  );
}

/** One stop in the vertical itinerary: arrive %, charge to %, time, cost. */
export function StopRow({
  stop,
  index,
  last,
}: {
  stop: RouteStop;
  index: number;
  last?: boolean;
}) {
  return (
    <View style={styles.stop}>
      <View style={styles.rail}>
        <View style={styles.railDot}>
          <Text style={styles.railNum}>{index + 1}</Text>
        </View>
        {!last && <View style={styles.railLine} />}
      </View>
      <View style={styles.flex}>
        <Text style={styles.stopName}>{stop.station.name}</Text>
        <Text style={styles.stopMeta}>
          Arrive {stop.arriveSoc}% → charge to {stop.chargeToSoc}% • ~
          {stop.chargeMin} min • {stopCostLabel(stop.costInr)}
        </Text>
      </View>
    </View>
  );
}

/**
 * The backup under a recommended stop. When no charger qualifies the stop says
 * so with a warning: a missing backup is never silently left out.
 */
export function StopBackup({
  stop,
  vehicle,
  now,
  onOpen,
}: {
  stop: RouteStop;
  vehicle: Vehicle | null;
  now: number;
  onOpen: (stationId: string) => void;
}) {
  const backup = stop.backup;
  if (!backup) {
    return (
      <Notice
        tone="warn"
        title="No backup for this stop"
        body={
          stop.backupNote ??
          'No compatible charger is close enough to be a backup here.'
        }
      />
    );
  }
  return (
    <BackupChargerCard
      station={backup}
      vehicle={vehicle}
      now={now}
      extraMin={stop.backupExtraMin}
      onPress={() => onOpen(backup.id)}
    />
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: {...type.h1, color: colors.ink, flex: 1},
  stats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
  },
  stat: {alignItems: 'flex-start', gap: 2, flex: 1},
  statValue: {...type.heading, color: colors.ink, marginTop: 4},
  statLabel: {...type.caption, color: colors.muted, fontSize: 11.5},
  reserve: {...type.caption, color: colors.muted, marginTop: spacing.md},
  stop: {flexDirection: 'row', gap: spacing.md},
  rail: {alignItems: 'center', width: 28},
  railDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  railNum: {...type.micro, color: colors.lime},
  railLine: {
    flex: 1,
    width: 2,
    backgroundColor: colors.inputBorder,
    marginVertical: 4,
    borderRadius: radii.sm,
  },
  stopName: {...type.heading, color: colors.ink},
  stopMeta: {
    ...type.caption,
    color: colors.inkSoft,
    marginTop: 4,
    marginBottom: spacing.lg,
  },
});
