import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {describeError} from '../../domain/describeError';
import {STALE_AFTER_MS, timeAgo} from '../../domain/trust';
import {stopCostLabel} from '../../domain/routeCost';
import {waitAtTime, waitBasisLabel, waitLabel} from '../../domain/rules';
import type {RouteStop, RouteStrategy, Vehicle} from '../../domain/types';
import {useNavigation} from '../../navigation/NavigationContext';
import {useServices} from '../../services';
import {openDirections} from '../../services/directions';
import {selectActiveVehicle, useApp} from '../../store/appStore';
import {useDemo} from '../../store/demoStore';
import {
  cacheRoute,
  chooseStop,
  toggleSavedRoute,
} from '../../store/tripActions';
import {colors, spacing, type} from '../../theme';
import {
  Card,
  ConfidenceBadge,
  ConfidencePill,
  EmptyState,
  IconButton,
  Notice,
  PriceLine,
  PrimaryButton,
  RouteMap,
  RouteSummary,
  Screen,
  SectionTitle,
  SegmentedControl,
  showToast,
  StatusBadge,
  StopBackup,
  StopRow,
  TextButton,
  useNow,
} from '../../ui';

const STRATEGIES: ReadonlyArray<{value: RouteStrategy; label: string}> = [
  {value: 'fastest', label: 'Fastest'},
  {value: 'cheapest', label: 'Cheapest'},
  {value: 'reliable', label: 'Reliable'},
];

/**
 * 09 Route result. Reads the cached plan, so it still works on a weak highway
 * signal. Every stop is shown with its backup.
 */
export default function RouteResultScreen(): React.JSX.Element {
  const nav = useNavigation();
  const now = useNow(30_000);
  const {route: routeService} = useServices();
  const route = useApp(s => s.activeRoute);
  const saved = useApp(s =>
    s.activeRoute
      ? s.savedRoutes.some(
          r =>
            r.fromLabel === s.activeRoute?.fromLabel &&
            r.toLabel === s.activeRoute?.toLabel,
        )
      : false,
  );
  const vehicle = useApp(selectActiveVehicle);
  const prefs = useApp(s => s.tripPrefs);
  const offline = useDemo(s => s.offline);
  const [replanning, setReplanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!route) {
    return (
      <Screen title="Route result">
        <EmptyState
          icon="route"
          title="No trip planned yet"
          body="Plan a trip and your recommended charging stops, with backups, show up here."
          primary={{
            label: 'Plan a trip',
            icon: 'route',
            onPress: () => nav.replace('RoutePlanner'),
          }}
        />
      </Screen>
    );
  }

  const age = now - route.computedAt;
  const stale = offline || age > STALE_AFTER_MS;

  const replan = async (strategy: RouteStrategy) => {
    if (!vehicle) {
      return;
    }
    setReplanning(true);
    setError(null);
    try {
      const next = await routeService.plan({
        fromLabel: route.fromLabel,
        toLabel: route.toLabel,
        via: route.via,
        startSoc: route.startSoc,
        strategy,
        vehicle,
        safetyReservePct: route.safetyReservePct,
        avoidPaidParking: prefs.avoidPaidParking,
      });
      cacheRoute(next);
    } catch (e) {
      setError(describeError(e, 'We couldn’t refresh your plan.').body);
    }
    setReplanning(false);
  };

  const start = async () => {
    const first = route.stops[0];
    if (first) {
      chooseStop(route, 0);
      nav.navigate('Navigation', {stationId: first.station.id, stopIndex: 0});
      return;
    }
    const end = route.polyline[route.polyline.length - 1];
    const ok = await openDirections({id: 'dest', ...end});
    if (!ok) {
      showToast('Couldn’t open Google Maps.', 'warn');
    }
  };

  return (
    <Screen
      title="Route result"
      stack
      right={
        <IconButton
          icon="heart"
          label={saved ? 'Remove saved route' : 'Save route'}
          tone={saved ? 'lime' : 'dark'}
          size={36}
          onPress={() =>
            showToast(
              toggleSavedRoute(route)
                ? 'Route saved.'
                : 'Route removed from saved.',
              'info',
            )
          }
        />
      }
      footer={
        <PrimaryButton
          label={route.stops.length > 0 ? 'Start trip' : 'Open navigation'}
          icon={route.stops.length > 0 ? 'navigation' : 'map'}
          loading={replanning}
          onPress={start}
        />
      }>
      <RouteMap route={route} height={210} highlightStop={0} />
      <RouteSummary
        route={route}
        cachedLabel={`Planned ${timeAgo(route.computedAt, now)}.`}
      />

      {stale && (
        <Notice
          tone="warn"
          title={
            offline ? 'Showing your saved plan' : 'This plan is getting old'
          }
          body="Charger statuses may have changed since you planned. We’ll warn you if your charger becomes occupied."
          action={
            <TextButton
              label="Refresh plan"
              icon="refresh-cw"
              onPress={() => replan(route.strategy)}
            />
          }
        />
      )}
      {error && <Notice tone="danger" title="Couldn’t refresh" body={error} />}

      <View>
        <Text style={styles.small}>Optimise for</Text>
        <View style={styles.seg}>
          <SegmentedControl
            options={STRATEGIES}
            value={route.strategy}
            onChange={replan}
          />
        </View>
      </View>

      {route.stops.length === 0 ? (
        <Notice
          tone="lime"
          title="No charging stop needed"
          body={`You’ll arrive with about ${route.arriveSoc}%, above your ${route.safetyReservePct}% reserve.`}
        />
      ) : (
        <>
          <SectionTitle title="Your charging stops" />
          {route.stops.map((stop, i) => (
            <View key={stop.station.id} style={styles.stopWrap}>
              <StopRow stop={stop} index={i} last />
              <StopCard
                stop={stop}
                vehicle={vehicle}
                now={now}
                onOpen={() =>
                  nav.navigate('StationDetail', {stationId: stop.station.id})
                }
              />
              <StopBackup
                stop={stop}
                vehicle={vehicle}
                now={now}
                onOpen={id => nav.navigate('StationDetail', {stationId: id})}
              />
            </View>
          ))}
        </>
      )}

      <View style={styles.links}>
        <TextButton
          label="Energy plan"
          icon="battery-charging"
          onPress={() => nav.navigate('EnergyPlanner')}
        />
        <TextButton
          label="Add stops"
          icon="route"
          onPress={() => nav.navigate('MultiStop')}
        />
      </View>
    </Screen>
  );
}

function StopCard({
  stop,
  vehicle,
  now,
  onOpen,
}: {
  stop: RouteStop;
  vehicle: Vehicle | null;
  now: number;
  onOpen: () => void;
}) {
  const connector =
    stop.station.connectors.find(c => c.id === stop.connectorId) ??
    stop.station.connectors[0];
  // "No wait" only while the live feed it came from is still live.
  const wait = waitAtTime(stop.wait, stop.station.statusFeed, now);
  return (
    <Card
      tone="lime"
      onPress={onOpen}
      accessibilityLabel={`Recommended stop ${stop.station.name}`}>
      <Text style={styles.kicker}>Recommended stop</Text>
      <Text style={styles.stopName}>{stop.station.name}</Text>
      <Text style={styles.stopMeta}>
        Arrive ~{stop.arriveSoc}% • charge ~{stop.chargeMin} min •{' '}
        {stopCostLabel(stop.costInr)}
      </Text>
      <View style={styles.badges}>
        <StatusBadge status={connector.status} />
        <ConfidenceBadge
          feed={stop.station.statusFeed}
          now={now}
          subject="Status"
        />
      </View>
      {stop.costInr !== null && (
        <View style={styles.priceLine}>
          <PriceLine station={stop.station} vehicle={vehicle} now={now} />
        </View>
      )}
      <View style={styles.waitRow}>
        <Text style={styles.stopMeta}>
          {wait.basis === 'none' ? '' : 'Wait: '}
          {waitLabel(wait)}
        </Text>
        <ConfidencePill confidence={wait.confidence} />
      </View>
      <Text style={styles.fine}>{waitBasisLabel(wait)}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  small: {...type.label, color: colors.muted},
  seg: {marginTop: spacing.sm},
  stopWrap: {gap: spacing.sm},
  kicker: {...type.micro, color: colors.limeDark, textTransform: 'uppercase'},
  stopName: {...type.h1, color: colors.ink, marginTop: 4},
  stopMeta: {...type.caption, color: colors.inkSoft, marginTop: 4},
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: spacing.md,
  },
  waitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    flexWrap: 'wrap',
  },
  fine: {...type.caption, color: colors.muted, marginTop: 2},
  priceLine: {marginTop: 4},
  links: {flexDirection: 'row', justifyContent: 'center', gap: spacing.xl},
});
