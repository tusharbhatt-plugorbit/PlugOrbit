import React, {useMemo, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {describeError} from '../../domain/describeError';
import {routeConfidence} from '../../domain/routeConfidence';
import {tripCost} from '../../domain/routeCost';
import {planAllStops} from '../../domain/tripEngine';
import {formatClock, formatDurationShort} from '../../utils/format';
import {
  useIsActiveRef,
  useNavigation,
} from '../../navigation/NavigationContext';
import {useServices} from '../../services';
import {selectActiveVehicle, useApp} from '../../store/appStore';
import {colors, spacing, type} from '../../theme';
import {
  Card,
  ChargerPickCard,
  EmptyState,
  Notice,
  PrimaryButton,
  RouteConfidenceCard,
  RouteMap,
  Screen,
  StatusLine,
  StopBackup,
  TextButton,
  ToggleRow,
  useNow,
} from '../../ui';
import {ConfirmActionSheet} from '../../ui/ConfirmActionSheet';

function Stat({value, label}: {value: string; label: string}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/**
 * Trip summary: the plan before you go, boiled down. Where to, when you'll
 * arrive, whether any charging is needed, and for each stop the charger we
 * chose, how long it takes, what it costs and its backup. One button starts
 * the trip, and Smart Drive takes it from there.
 */
export default function TripSummaryScreen(): React.JSX.Element {
  const nav = useNavigation();
  const active = useIsActiveRef();
  const now = useNow(30_000);
  const {trip: tripService} = useServices();
  const route = useApp(s => s.activeRoute);
  const vehicle = useApp(selectActiveVehicle);
  const [smartDrive, setSmartDrive] = useState(true);
  const [starting, setStarting] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const planned = useMemo(
    () => (route && vehicle ? planAllStops(route, vehicle, now) : []),
    [route, vehicle, now],
  );
  const confidence = useMemo(
    () => (route ? routeConfidence(route, now) : null),
    [route, now],
  );

  if (!route || !vehicle) {
    return (
      <Screen title="Trip summary">
        <EmptyState
          icon="route"
          title={route ? 'Add your car first' : 'No trip planned yet'}
          body={
            route
              ? 'We plan around your battery and the plugs your car can use.'
              : 'Tell us where you’re going and we’ll plan the charging for you.'
          }
          primary={{
            label: route ? 'Add your EV' : 'Plan a trip',
            icon: route ? 'plus' : 'route',
            onPress: () =>
              route
                ? nav.navigate('VehicleSetup')
                : nav.replace('RoutePlanner'),
          }}
        />
      </Screen>
    );
  }

  const cost = tripCost(route.stops);
  const unbacked = route.stops.filter(s => !s.backup).length;
  const eta = formatClock(now + route.driveMin * 60_000);

  const start = async (replace = false) => {
    setStarting(true);
    setError(null);
    try {
      await tripService.start({route, smartDrive, replace});
      if (active.current) {
        setConfirmReplace(false);
        nav.replace('SmartDrive');
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'TripInProgressError') {
        setConfirmReplace(true);
      } else {
        setError(describeError(e, 'We couldn’t start your trip.').body);
      }
    }
    setStarting(false);
  };

  return (
    <Screen
      title="Trip summary"
      stack
      footer={
        <PrimaryButton
          label="Start trip"
          icon="navigation"
          loading={starting && !confirmReplace}
          onPress={() => start(false)}
          testID="start-trip"
        />
      }>
      <RouteMap route={route} height={190} highlightStop={0} />

      <Card tone="dark">
        <Text style={styles.kicker}>
          {route.fromLabel} → {route.toLabel}
        </Text>
        <Text style={styles.heroTitle}>
          {route.stops.length === 0
            ? 'No charging needed'
            : `${route.stops.length} charging ${
                route.stops.length === 1 ? 'stop' : 'stops'
              }, planned`}
        </Text>
        <View style={styles.stats}>
          <Stat value={eta} label="Arrive about" />
          <Stat
            value={formatDurationShort(route.driveMin)}
            label="Total time"
          />
          <Stat value={`${route.arriveSoc}%`} label="Arrive with" />
          <Stat value={`${route.distanceKm} km`} label="Distance" />
        </View>
      </Card>

      {route.stops.length === 0 ? (
        <Card tone="lime">
          <StatusLine
            tone="good"
            headline="You’re good to drive."
            detail={`You’ll arrive with about ${route.arriveSoc}%, above your ${route.safetyReservePct}% reserve. No charging needed.`}
          />
        </Card>
      ) : (
        <Card tone={unbacked === 0 ? 'lime' : 'warn'}>
          <StatusLine
            tone={unbacked === 0 ? 'good' : 'warn'}
            headline={
              unbacked === 0
                ? 'We’ve got your charging covered.'
                : 'Your charging is planned, with a caution.'
            }
            detail={
              unbacked === 0
                ? `Every stop has a backup, and we’ll keep watching them as you drive. Charging cost: ${cost.label}.`
                : `${unbacked} of ${route.stops.length} stops have no close backup, so we’ll watch those closely.`
            }
          />
        </Card>
      )}

      {confidence && <RouteConfidenceCard route={confidence} />}

      {route.stops.map((stop, i) => {
        const p = planned[i];
        if (p && p.scored) {
          return (
            <ChargerPickCard
              key={stop.station.id}
              pick={p.scored}
              backup={stop.backup ? {name: stop.backup.name} : null}
              backupExtraMin={stop.backupExtraMin}
              now={now}
              kicker={`Charging stop ${i + 1}`}
              onDetails={() =>
                nav.navigate('StationDetail', {stationId: stop.station.id})
              }
              onBackup={
                stop.backup
                  ? () =>
                      nav.navigate('StationDetail', {
                        stationId: stop.backup!.id,
                      })
                  : undefined
              }
              testID={`stop-pick-${i}`}
            />
          );
        }
        // The engine couldn't vouch for this stop (for example it may be closed
        // by the time we get there): show the plain stop and its backup.
        return (
          <View key={stop.station.id} style={styles.fallback}>
            <Card>
              <Text style={styles.fallbackKicker}>Charging stop {i + 1}</Text>
              <Text style={styles.fallbackName}>{stop.station.name}</Text>
              <Text style={styles.fallbackMeta}>
                Arrive {stop.arriveSoc}% → charge to {stop.chargeToSoc}% • ~
                {stop.chargeMin} min
              </Text>
            </Card>
            <StopBackup
              stop={stop}
              vehicle={vehicle}
              now={now}
              onOpen={id => nav.navigate('StationDetail', {stationId: id})}
            />
          </View>
        );
      })}

      <Card>
        <ToggleRow
          title="Smart Drive"
          subtitle="Let PlugOrbit manage charging decisions during your trip. We watch your charger and backup, and tell you only when it matters."
          value={smartDrive}
          onValueChange={setSmartDrive}
          last
        />
      </Card>

      {error && <Notice tone="danger" title="Couldn’t start" body={error} />}

      <View style={styles.links}>
        <TextButton
          label="Full route details"
          icon="route"
          onPress={() => nav.navigate('RouteResult')}
        />
        <TextButton
          label="Energy plan"
          icon="battery-charging"
          onPress={() => nav.navigate('EnergyPlanner')}
        />
      </View>

      <ConfirmActionSheet
        visible={confirmReplace}
        title="Replace your current trip?"
        body="You already have a trip in progress. Starting this one ends that trip."
        confirmLabel="Replace it"
        cancelLabel="Keep my current trip"
        icon="route"
        loading={starting}
        onConfirm={() => start(true)}
        onCancel={() => setConfirmReplace(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  kicker: {...type.micro, color: colors.lime, textTransform: 'uppercase'},
  heroTitle: {...type.display, color: '#FFFFFF', marginTop: 4},
  stats: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.chipBorder,
  },
  stat: {flex: 1},
  statValue: {...type.heading, color: '#FFFFFF'},
  statLabel: {
    ...type.caption,
    color: colors.chipText,
    fontSize: 11.5,
    marginTop: 2,
  },
  fallback: {gap: spacing.sm},
  fallbackKicker: {
    ...type.micro,
    color: colors.limeDark,
    textTransform: 'uppercase',
  },
  fallbackName: {...type.h1, color: colors.ink, marginTop: 4},
  fallbackMeta: {...type.caption, color: colors.inkSoft, marginTop: 4},
  links: {flexDirection: 'row', justifyContent: 'center', gap: spacing.xl},
});
