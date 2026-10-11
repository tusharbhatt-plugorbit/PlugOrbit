import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {
  removeSavedRoute,
  setActiveRoute,
  toggleFavouriteStation,
} from '../../domain/favourites';
import type {RouteStrategy, SavedRoute} from '../../domain/types';
import {loadStationsById} from '../../hooks/useDiscoverStations';
import {useNavigation} from '../../navigation/NavigationContext';
import {useServices} from '../../services';
import {ApiError, OfflineError} from '../../services/types';
import {appStore, selectActiveVehicle, useApp} from '../../store/appStore';
import {colors, spacing, type} from '../../theme';
import {
  AsyncView,
  Card,
  ChargerCard,
  EmptyState,
  IconButton,
  ListSkeleton,
  Notice,
  Pill,
  PrimaryButton,
  Screen,
  SegmentedControl,
  TextButton,
  showToast,
  useNow,
  useResource,
} from '../../ui';
import {formatDate} from '../../utils/format';
import {timeAgo} from '../../domain/trust';

type Segment = 'stations' | 'routes';

const STRATEGY_LABEL: Record<RouteStrategy, string> = {
  fastest: 'Fastest',
  cheapest: 'Cheapest',
  reliable: 'Most reliable',
};

function planErrorMessage(e: unknown): string {
  if (e instanceof OfflineError) {
    return 'You’re offline, so we can’t re-plan this trip right now.';
  }
  return e instanceof ApiError || e instanceof Error
    ? e.message
    : 'We couldn’t plan this trip. Try again.';
}

function StationsTab() {
  const nav = useNavigation();
  const now = useNow();
  const {station: stationService} = useServices();
  const vehicle = useApp(selectActiveVehicle);
  const favourites = useApp(s => s.favouriteStationIds);
  const key = favourites.join('|');

  const resource = useResource(
    () => loadStationsById(stationService, favourites),
    [key, stationService],
    {enabled: favourites.length > 0},
  );

  const unsave = (id: string) => {
    toggleFavouriteStation(id);
    showToast('Removed from saved', 'info');
  };

  if (favourites.length === 0) {
    return (
      <EmptyState
        icon="heart"
        title="No saved chargers yet"
        body="Tap the heart on a charger to keep it here for quick access."
        primary={{
          label: 'Find chargers',
          icon: 'search',
          onPress: () => nav.navigate('StationList'),
        }}
        secondary={{label: 'Open the map', onPress: () => nav.navigate('Map')}}
      />
    );
  }

  return (
    <AsyncView
      resource={resource}
      loading={<ListSkeleton count={Math.min(favourites.length, 3)} />}
      errorTitle="Couldn’t load your saved chargers"
      errorBody="Check your connection and try again."
      render={data => {
        // Optimistic: a charger you just un-saved disappears immediately.
        const shown = data.stations.filter(s => favourites.includes(s.id));
        return (
          <View style={styles.stack}>
            {data.fromCache && (
              <Notice
                tone="warn"
                icon="wifi-off"
                title="You’re offline"
                body="Showing the chargers we saved earlier. Status and prices may have changed."
                action={
                  <TextButton
                    label="Retry"
                    icon="refresh-cw"
                    onPress={resource.reload}
                  />
                }
              />
            )}
            {data.missing.length > 0 && (
              <Notice
                tone="info"
                title={`${data.missing.length} saved charger${
                  data.missing.length === 1 ? ' isn’t' : 's aren’t'
                } available right now`}
                body="It may have been removed, or it’s a Google Maps charger that isn’t near you at the moment."
                action={
                  <TextButton
                    label="Remove from saved"
                    onPress={() => {
                      appStore.set(s => ({
                        favouriteStationIds: s.favouriteStationIds.filter(
                          id => !data.missing.includes(id),
                        ),
                      }));
                    }}
                  />
                }
              />
            )}
            <Text style={styles.count}>
              {shown.length} saved charger{shown.length === 1 ? '' : 's'}
            </Text>
            {shown.length === 0 && (
              <PrimaryButton
                label="Find chargers"
                icon="search"
                onPress={() => nav.navigate('StationList')}
              />
            )}
            {shown.map(s => (
              <ChargerCard
                key={s.id}
                station={s}
                vehicle={vehicle}
                now={now}
                favourite
                testID={`saved-station-${s.id}`}
                onPress={() => nav.navigate('StationDetail', {stationId: s.id})}
                onToggleFavourite={() => unsave(s.id)}
              />
            ))}
          </View>
        );
      }}
    />
  );
}

function RoutesTab() {
  const nav = useNavigation();
  const {route: routeService} = useServices();
  const vehicle = useApp(selectActiveVehicle);
  const battery = useApp(s => s.battery);
  const tripPrefs = useApp(s => s.tripPrefs);
  const savedRoutes = useApp(s => s.savedRoutes);
  const cached = useApp(s => s.activeRoute);
  const [planning, setPlanning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const planAgain = async (r: SavedRoute) => {
    if (planning) {
      return;
    }
    if (!vehicle) {
      showToast('Add your vehicle first so we can plan for it.', 'warn');
      nav.navigate('VehicleSetup');
      return;
    }
    setError(null);
    setPlanning(r.id);
    try {
      const route = await routeService.plan({
        fromLabel: r.fromLabel,
        toLabel: r.toLabel,
        startSoc: battery?.percent ?? 80,
        strategy: r.strategy,
        vehicle,
        safetyReservePct: tripPrefs.minArrivalSocPct,
        avoidPaidParking: tripPrefs.avoidPaidParking,
      });
      setActiveRoute(route);
      nav.navigate('RouteResult');
    } catch (e) {
      // Offline but we still hold this exact plan: open it rather than fail.
      if (
        e instanceof OfflineError &&
        cached &&
        cached.fromLabel === r.fromLabel &&
        cached.toLabel === r.toLabel
      ) {
        showToast(
          `Offline: showing the plan saved ${timeAgo(
            cached.computedAt,
            Date.now(),
          )}.`,
          'warn',
        );
        nav.navigate('RouteResult');
      } else {
        setError(`${r.fromLabel} → ${r.toLabel}: ${planErrorMessage(e)}`);
      }
    } finally {
      setPlanning(null);
    }
  };

  if (savedRoutes.length === 0) {
    return (
      <EmptyState
        icon="route"
        title="No saved routes yet"
        body="Plan a trip and save it to run it again in one tap."
        primary={{
          label: 'Plan a route',
          icon: 'route',
          onPress: () => nav.navigate('RoutePlanner'),
        }}
      />
    );
  }

  return (
    <View style={styles.stack}>
      {!vehicle && (
        <Notice
          tone="info"
          icon="car"
          title="Add your EV to plan these trips"
          body="Routes are planned around your car’s battery and connectors."
          action={
            <TextButton
              label="Add your vehicle"
              onPress={() => nav.navigate('VehicleSetup')}
            />
          }
        />
      )}
      {error && (
        <Notice
          tone="danger"
          title="Couldn’t plan this trip"
          body={error}
          action={
            <TextButton
              label="Dismiss"
              tone="muted"
              onPress={() => setError(null)}
            />
          }
        />
      )}
      <Text style={styles.count}>
        {savedRoutes.length} saved route{savedRoutes.length === 1 ? '' : 's'}
      </Text>
      {savedRoutes.map(r => (
        <Card key={r.id} testID={`saved-route-${r.id}`}>
          <View style={styles.routeHead}>
            <Text style={styles.routeTitle} numberOfLines={2}>
              {r.fromLabel} → {r.toLabel}
            </Text>
            <Pill label={STRATEGY_LABEL[r.strategy]} tone="lime" />
          </View>
          <Text style={styles.routeMeta}>Saved {formatDate(r.savedAt)}</Text>
          <View style={styles.routeActions}>
            <PrimaryButton
              label="Plan again"
              icon="route"
              compact
              loading={planning === r.id}
              onPress={() => planAgain(r)}
              style={styles.flex}
            />
            <IconButton
              icon="trash2"
              label={`Remove ${r.fromLabel} to ${r.toLabel}`}
              onPress={() => {
                removeSavedRoute(r.id);
                showToast('Route removed', 'info');
              }}
            />
          </View>
        </Card>
      ))}
    </View>
  );
}

/** 25 Saved stations and routes. */
export default function SavedScreen(): React.JSX.Element {
  const stationCount = useApp(s => s.favouriteStationIds.length);
  const routeCount = useApp(s => s.savedRoutes.length);
  const [segment, setSegment] = useState<Segment>('stations');

  return (
    <Screen title="Saved">
      <View style={styles.stack}>
        <SegmentedControl
          value={segment}
          onChange={setSegment}
          options={[
            {value: 'stations', label: `Stations (${stationCount})`},
            {value: 'routes', label: `Routes (${routeCount})`},
          ]}
        />
        {segment === 'stations' ? <StationsTab /> : <RoutesTab />}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  stack: {gap: spacing.md},
  count: {...type.label, color: colors.inkSoft},
  routeHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  routeTitle: {...type.heading, color: colors.ink, flex: 1},
  routeMeta: {...type.caption, color: colors.muted, marginTop: spacing.xs},
  routeActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
});
