import React, {useCallback, useMemo, useState} from 'react';
import {Linking, StyleSheet, Text, View} from 'react-native';
import {
  DEFAULT_FILTERS,
  applyFilters,
  countActiveFilters,
  hasUnconfirmedConnectors,
  isCompatible,
  stationHealth,
} from '../../domain/rules';
import {
  QUICK_OPTIONS,
  QuickFilter,
  SORT_OPTIONS,
  SortMode,
  hiddenIncompatibleCount,
  matchesQuick,
  matchesText,
  sortStations,
} from '../../domain/discover';
import {toggleFavouriteStation} from '../../domain/favourites';
import type {StationWithDistance, Vehicle} from '../../domain/types';
import {
  DEMO_AREA_BODY,
  DEMO_AREA_TITLE,
  DiscoverData,
  useDiscoverStations,
} from '../../hooks/useDiscoverStations';
import {useNavigation, useRoute} from '../../navigation/NavigationContext';
import {appStore, selectActiveVehicle, useApp} from '../../store/appStore';
import {colors, radii, spacing, type} from '../../theme';
import {
  AsyncView,
  Card,
  ChargerCard,
  EmptyState,
  ListSkeleton,
  Notice,
  PermissionPrompt,
  PrimaryButton,
  Screen,
  SearchField,
  SegmentedControl,
  TextButton,
  showToast,
  useNow,
  vehicleName,
} from '../../ui';
import {HeaderChipRow, HeaderFilterButton} from '../../ui/DiscoverParts';
import {timeAgo} from '../../domain/trust';

const MAX_COMPARE = 3;

const SORT_HINT: Record<SortMode, string> = {
  best: 'Ranked by reliability, availability and detour. Sponsored chargers are never boosted.',
  nearest: 'Closest first.',
  cheapest:
    'Lowest price per kWh first. Chargers without a published price come last.',
  fastest: '',
};

type RowProps = {
  station: StationWithDistance;
  vehicle: Vehicle | null;
  now: number;
  favourite: boolean;
  selected: boolean;
  recommended: boolean;
  onOpen: (id: string) => void;
  onToggleFavourite: (id: string) => void;
};

/** Stable per-row handlers so the memoised card only re-renders when it must. */
const StationRow = React.memo(function StationRowInner({
  station,
  vehicle,
  now,
  favourite,
  selected,
  recommended,
  onOpen,
  onToggleFavourite,
}: RowProps) {
  return (
    <ChargerCard
      station={station}
      vehicle={vehicle}
      now={now}
      favourite={favourite}
      selected={selected}
      recommended={recommended}
      testID={`station-card-${station.id}`}
      onPress={() => onOpen(station.id)}
      onToggleFavourite={() => onToggleFavourite(station.id)}
    />
  );
});

type BodyProps = {
  data: DiscoverData;
  vehicle: Vehicle | null;
  now: number;
  query: string;
  setQuery: (q: string) => void;
  quick: QuickFilter;
  setQuick: (q: QuickFilter) => void;
  compareMode: boolean;
  setCompareMode: (on: boolean) => void;
  picked: string[];
  setPicked: React.Dispatch<React.SetStateAction<string[]>>;
  onRetryLocation: () => void;
  onRetry: () => void;
};

function StationListBody({
  data,
  vehicle,
  now,
  query,
  setQuery,
  quick,
  setQuick,
  compareMode,
  setCompareMode,
  picked,
  setPicked,
  onRetryLocation,
  onRetry,
}: BodyProps) {
  const nav = useNavigation();
  const filters = useApp(s => s.filters);
  const favourites = useApp(s => s.favouriteStationIds);
  const [sort, setSort] = useState<SortMode>('best');
  const [skipLocationPrompt, setSkipLocationPrompt] = useState(false);

  const visible = useMemo(() => {
    const filtered = applyFilters(data.stations, filters, vehicle)
      .filter(s => matchesQuick(s, quick, vehicle, favourites))
      .filter(s => matchesText(s, query));
    return sortStations(filtered, sort, vehicle);
  }, [data.stations, filters, vehicle, quick, query, sort, favourites]);

  const hiddenCount = hiddenIncompatibleCount(data.stations, filters, vehicle);
  const incompatibleTotal = vehicle
    ? data.stations.filter(s => !isCompatible(s, vehicle)).length
    : 0;
  // Chargers whose connectors the source never listed are hidden with the
  // incompatible ones, but "doesn't fit" would be a claim we can't make.
  const unconfirmedTotal = vehicle
    ? data.stations.filter(hasUnconfirmedConnectors).length
    : 0;
  const hiddenNote =
    unconfirmedTotal > 0 ? ', or we can’t confirm their connectors' : '';
  const shownNote =
    unconfirmedTotal > 0 ? ' or whose connectors we can’t confirm' : '';
  const activeFilters = countActiveFilters(filters);

  const recommendedId = useMemo(() => {
    const top = sort === 'best' ? visible[0] : undefined;
    return top && stationHealth(top, vehicle) === 'available' ? top.id : null;
  }, [sort, visible, vehicle]);

  const open = useCallback(
    (id: string) => {
      if (compareMode) {
        setPicked(prev => {
          if (prev.includes(id)) {
            return prev.filter(x => x !== id);
          }
          if (prev.length >= MAX_COMPARE) {
            showToast(`You can compare up to ${MAX_COMPARE} chargers.`, 'warn');
            return prev;
          }
          return [...prev, id];
        });
        return;
      }
      nav.navigate('StationDetail', {stationId: id});
    },
    [compareMode, nav, setPicked],
  );

  const toggleFavourite = useCallback((id: string) => {
    const saved = toggleFavouriteStation(id);
    showToast(saved ? 'Saved to your list' : 'Removed from saved', 'success');
  }, []);

  const stopCompare = () => {
    setCompareMode(false);
    setPicked([]);
  };

  const clearAll = () => {
    setQuery('');
    setQuick('all');
    appStore.set({filters: DEFAULT_FILTERS});
  };

  const openSettings = () => {
    Promise.resolve(Linking.openSettings()).catch(() => undefined);
    showToast('Turn on location, then pull down to refresh.', 'info');
  };

  const sortHint =
    sort === 'fastest'
      ? vehicle
        ? `Ranked by the speed your ${vehicleName(
            vehicle,
          )} can actually draw, not the charger’s rating.`
        : 'Highest charger power first.'
      : SORT_HINT[sort];

  // ------------------------------------------------------------- top notices
  const notices: React.ReactNode[] = [];
  if (data.locationIssue === 'denied' && !skipLocationPrompt) {
    notices.push(
      <Card key="perm" padded={false}>
        <PermissionPrompt
          kind="location"
          denied
          onAllow={onRetryLocation}
          onOpenSettings={openSettings}
          onSkip={() => setSkipLocationPrompt(true)}
        />
      </Card>,
    );
  } else if (data.locationIssue) {
    notices.push(
      <Notice
        key="loc"
        tone="warn"
        icon="map-pin"
        title={
          data.locationIssue === 'denied'
            ? 'Location is off'
            : 'Couldn’t get your location'
        }
        body="Showing chargers near New Delhi. Distances are measured from there."
        action={<TextButton label="Try again" onPress={onRetryLocation} />}
      />,
    );
  }
  if (data.demoArea) {
    notices.push(
      <Notice
        key="demo"
        tone="warn"
        icon="map-pin"
        title={DEMO_AREA_TITLE}
        body={`${DEMO_AREA_BODY} Distances are measured from there.`}
      />,
    );
  }
  if (data.fromCache) {
    notices.push(
      <Notice
        key="cache"
        tone="warn"
        icon="wifi-off"
        title="You’re offline"
        body={`Showing the chargers we saved ${timeAgo(
          data.loadedAt,
          now,
        )}. Status and prices may have changed.`}
        action={
          <TextButton label="Retry" onPress={onRetry} icon="refresh-cw" />
        }
      />,
    );
  }
  if (!vehicle) {
    notices.push(
      <Notice
        key="veh"
        tone="info"
        icon="car"
        title="Add your EV to filter by compatibility"
        body="Until then we can’t tell which chargers fit your car."
        action={
          <TextButton
            label="Add your vehicle"
            onPress={() => nav.navigate('VehicleSetup')}
          />
        }
      />,
    );
  }

  // ----------------------------------------------------------------- empties
  if (data.stations.length === 0) {
    return (
      <View style={styles.stack}>
        {notices}
        <EmptyState
          icon="plug-zap"
          title={
            vehicle ? 'No compatible chargers nearby' : 'No chargers found'
          }
          body={
            vehicle
              ? `We couldn’t find a charger near you that fits your ${vehicleName(
                  vehicle,
                )}. Check your vehicle details or try again later.`
              : 'We couldn’t find any chargers near you. Try again in a moment.'
          }
          primary={
            vehicle
              ? {
                  label: 'Check my vehicle',
                  icon: 'car',
                  onPress: () => nav.navigate('Vehicles'),
                }
              : {
                  label: 'Add your vehicle',
                  icon: 'car',
                  onPress: () => nav.navigate('VehicleSetup'),
                }
          }
          secondary={{label: 'Try again', onPress: onRetry}}
        />
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      {notices}

      <SegmentedControl
        options={SORT_OPTIONS}
        value={sort}
        onChange={setSort}
      />
      {sortHint ? <Text style={styles.hint}>{sortHint}</Text> : null}

      <View style={styles.countRow}>
        <Text style={styles.count} accessibilityLiveRegion="polite">
          {compareMode
            ? `${picked.length} of ${MAX_COMPARE} selected`
            : `${visible.length} charger${visible.length === 1 ? '' : 's'}${
                activeFilters > 0
                  ? ` • ${activeFilters} filter${
                      activeFilters === 1 ? '' : 's'
                    }`
                  : ''
              }`}
        </Text>
        {visible.length > 1 && (
          <TextButton
            label={compareMode ? 'Cancel' : 'Compare'}
            icon={compareMode ? 'x' : 'scale'}
            onPress={compareMode ? stopCompare : () => setCompareMode(true)}
          />
        )}
      </View>

      {visible.length === 0 ? (
        <EmptyState
          icon="search"
          title="No chargers match"
          body={
            query.trim()
              ? `Nothing matches “${query.trim()}” with your current filters.`
              : 'Try removing a filter to see more chargers.'
          }
          primary={{label: 'Clear filters', icon: 'x', onPress: clearAll}}
          secondary={{
            label: 'Edit filters',
            onPress: () => nav.navigate('Filters'),
          }}
        />
      ) : (
        visible.map(s => (
          <StationRow
            key={s.id}
            station={s}
            vehicle={vehicle}
            now={now}
            favourite={favourites.includes(s.id)}
            selected={picked.includes(s.id)}
            recommended={s.id === recommendedId}
            onOpen={open}
            onToggleFavourite={toggleFavourite}
          />
        ))
      )}

      {hiddenCount > 0 && vehicle && (
        <Card tone="default" style={styles.hidden}>
          <Text style={styles.hiddenText}>
            {hiddenCount} charger{hiddenCount === 1 ? '' : 's'} hidden because{' '}
            {hiddenCount === 1 ? 'it doesn’t' : 'they don’t'} fit your{' '}
            {vehicleName(vehicle)}
            {hiddenNote}.
          </Text>
          <TextButton
            label="Show them"
            icon="eye"
            onPress={() =>
              appStore.set(s => ({
                filters: {...s.filters, includeIncompatible: true},
              }))
            }
          />
        </Card>
      )}
      {filters.includeIncompatible && incompatibleTotal > 0 && vehicle && (
        <Card tone="warn" style={styles.hidden}>
          <Text style={styles.hiddenText}>
            Showing {incompatibleTotal} charger
            {incompatibleTotal === 1 ? '' : 's'} that can’t charge your{' '}
            {vehicleName(vehicle)}
            {shownNote}.
          </Text>
          <TextButton
            label="Hide them"
            icon="eye-off"
            onPress={() =>
              appStore.set(s => ({
                filters: {...s.filters, includeIncompatible: false},
              }))
            }
          />
        </Card>
      )}
    </View>
  );
}

/** 04 Nearby chargers. */
export default function StationListScreen(): React.JSX.Element {
  const nav = useNavigation();
  const {params} = useRoute<'StationList'>();
  const now = useNow();
  const vehicle = useApp(selectActiveVehicle);
  const filters = useApp(s => s.filters);
  const resource = useDiscoverStations(vehicle);
  const [query, setQuery] = useState(params?.query ?? '');
  const [quick, setQuick] = useState<QuickFilter>('all');
  const [compareMode, setCompareMode] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  const stopCompare = () => {
    setCompareMode(false);
    setPicked([]);
  };

  return (
    <Screen
      title="Nearby chargers"
      refreshing={resource.refreshing}
      onRefresh={resource.reload}
      footer={
        compareMode ? (
          <PrimaryButton
            label={
              picked.length >= 2
                ? `Compare ${picked.length} chargers`
                : 'Select 2 or 3 chargers'
            }
            icon="scale"
            disabled={picked.length < 2}
            onPress={() => {
              const ids = picked;
              stopCompare();
              nav.navigate('Compare', {stationIds: ids});
            }}
          />
        ) : undefined
      }
      headerExtra={
        <>
          <View style={styles.searchRow}>
            <View style={styles.searchField}>
              <SearchField
                value={query}
                onChangeText={setQuery}
                placeholder="Search city or charger name"
              />
            </View>
            <HeaderFilterButton
              count={countActiveFilters(filters)}
              onPress={() => nav.navigate('Filters')}
            />
          </View>
          <HeaderChipRow
            options={QUICK_OPTIONS}
            value={quick}
            onChange={setQuick}
          />
        </>
      }>
      <AsyncView
        resource={resource}
        loading={<ListSkeleton count={4} />}
        errorTitle="Couldn’t load chargers"
        errorBody="We couldn’t reach the charger service. Check your connection and try again."
        render={data => (
          <StationListBody
            data={data}
            vehicle={vehicle}
            now={now}
            query={query}
            setQuery={setQuery}
            quick={quick}
            setQuick={setQuick}
            compareMode={compareMode}
            setCompareMode={setCompareMode}
            picked={picked}
            setPicked={setPicked}
            onRetryLocation={resource.reload}
            onRetry={resource.reload}
          />
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: {gap: spacing.md},
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  searchField: {flex: 1},
  hint: {...type.caption, color: colors.muted, marginTop: -spacing.xs},
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 32,
  },
  count: {...type.label, color: colors.inkSoft},
  hidden: {gap: spacing.sm, borderRadius: radii.lg},
  hiddenText: {...type.body, color: colors.inkSoft, lineHeight: 20},
});
