import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import ChargerMap, {ChargerMapHandle} from '../../components/ChargerMap';
import {MapUnavailable} from '../../components/MapUnavailable';
import {mapsKeyMissing} from '../../config/google';
import {
  applyFilters,
  availableCount,
  countActiveFilters,
  maxPowerKw,
  rankOrganic,
} from '../../domain/rules';
import type {StationWithDistance} from '../../domain/types';
import {useNearbyStations} from '../../hooks/useNearbyStations';
import {useNavigation} from '../../navigation/NavigationContext';
import {selectActiveVehicle, useApp} from '../../store/appStore';
import {colors, elevation, radii, slopFor, spacing, type} from '../../theme';
import {
  Icon,
  LocationPermissionState,
  LogoTile,
  MapChargerCard,
  OfflineBanner,
  VehicleSelector,
  useNow,
} from '../../ui';
import {Coords, distanceKm} from '../../utils/geo';

type QuickFilter = 'All' | 'Fast' | 'Available' | 'Near me';
const QUICK_FILTERS: readonly QuickFilter[] = [
  'All',
  'Fast',
  'Available',
  'Near me',
];
const FAST_KW = 50;
const NEAR_KM = 3;

// Offer "Search this area" once the map has been panned this far from the
// point the current results were centred on.
const RESEARCH_KM = 2;

// A native map normally reports ready within a second or two. If it has not
// after this long (Play Services missing or out of date, a broken provider),
// say so instead of leaving a blank rectangle.
const MAP_READY_TIMEOUT_MS = 15_000;

/**
 * Home / Map (03). The approved layout: dark header with title, white search
 * field, filter chips, then the map with a bottom station card. Extended with
 * the vehicle chip, notifications, a filters button and the list view.
 */
function HomeScreen(): React.JSX.Element {
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const now = useNow();
  const mapRef = useRef<ChargerMapHandle>(null);
  const vehicle = useApp(selectActiveVehicle);
  const filters = useApp(s => s.filters);
  const unread = useApp(s => s.notifications.some(n => !n.read));
  const {phase, stations, userLocation, origin, notice, refresh, searchAt} =
    useNearbyStations(vehicle);

  const [query, setQuery] = useState('');
  const [quick, setQuick] = useState<QuickFilter>('All');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapCenter, setMapCenter] = useState<Coords | null>(null);
  const autoSelected = useRef(false);
  const [mapStatus, setMapStatus] = useState<'loading' | 'ready' | 'failed'>(
    'loading',
  );
  // Bumped to remount the map when the person taps Retry.
  const [mapAttempt, setMapAttempt] = useState(0);
  const [permissionDismissed, setPermissionDismissed] = useState(false);
  // Times the person asked again after a refusal; one failed retry means the
  // OS will not ask any more, so Settings becomes the main action.
  const [retries, setRetries] = useState(0);
  // Set when we sent them to Settings, so coming back re-checks location.
  const wentToSettings = useRef(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = applyFilters(stations, filters, vehicle).filter(s => {
      if (quick === 'Fast' && maxPowerKw(s, vehicle) < FAST_KW) {
        return false;
      }
      if (quick === 'Available' && availableCount(s, vehicle) === 0) {
        return false;
      }
      if (quick === 'Near me' && s.distanceKm > NEAR_KM) {
        return false;
      }
      return (
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.address.toLowerCase().includes(q) ||
        s.operator.toLowerCase().includes(q)
      );
    });
    return base;
  }, [stations, filters, vehicle, quick, query]);

  const selected = useMemo(
    () => visible.find(s => s.id === selectedId) ?? null,
    [visible, selectedId],
  );
  const best: StationWithDistance | null = useMemo(
    () => rankOrganic(visible, vehicle)[0] ?? null,
    [visible, vehicle],
  );

  // Fly to each new search origin (the device on first load, or "this area").
  useEffect(() => {
    mapRef.current?.animateTo(origin);
    setMapCenter(null);
  }, [origin]);

  // Open the best nearby charger once, so the screen lands on something useful.
  useEffect(() => {
    if (phase === 'ready' && !autoSelected.current && best) {
      autoSelected.current = true;
      setSelectedId(best.id);
    }
  }, [phase, best]);

  const select = useCallback(
    (id: string) => {
      // Picking a charger means getting on with it: stop asking about location.
      setPermissionDismissed(true);
      setSelectedId(id);
      const s = visible.find(x => x.id === id);
      if (s) {
        mapRef.current?.animateTo(s, true);
      }
    },
    [visible],
  );
  const deselect = useCallback(() => setSelectedId(null), []);

  const recenter = useCallback(() => {
    if (userLocation) {
      mapRef.current?.animateTo(userLocation);
    } else {
      refresh();
    }
  }, [userLocation, refresh]);

  const searchHere = useCallback(() => {
    if (mapCenter) {
      setSelectedId(null);
      searchAt(mapCenter);
    }
  }, [mapCenter, searchAt]);

  // Report a map that never finishes initialising (not when it is not drawn).
  useEffect(() => {
    if (mapsKeyMissing) {
      return;
    }
    const timer = setTimeout(
      () => setMapStatus(s => (s === 'ready' ? s : 'failed')),
      MAP_READY_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [mapAttempt]);

  const retryMap = useCallback(() => {
    setMapStatus('loading');
    setMapAttempt(n => n + 1);
  }, []);
  const onMapReady = useCallback(() => setMapStatus('ready'), []);

  const retryLocation = useCallback(() => {
    setPermissionDismissed(false);
    setRetries(n => n + 1);
    refresh();
  }, [refresh]);

  const busy = phase !== 'ready';
  const showSearchHere =
    !busy && mapCenter !== null && distanceKm(mapCenter, origin) > RESEARCH_KM;
  const canRetry =
    notice?.kind === 'location-denied' ||
    notice?.kind === 'location-unavailable' ||
    notice?.kind === 'location-no-fix' ||
    notice?.kind === 'search-failed' ||
    notice?.kind === 'offline';
  const permissionIssue =
    notice?.kind === 'location-denied'
      ? 'denied'
      : notice?.kind === 'location-unavailable'
      ? 'unavailable'
      : notice?.kind === 'location-no-fix'
      ? 'no-fix'
      : null;
  // Services off needs the device's location switch; a denial needs the app's
  // permission page (iOS never asks twice, Android stops after "don't ask").
  const settingsFirst =
    permissionIssue === 'unavailable' ||
    (permissionIssue === 'denied' && (Platform.OS === 'ios' || retries > 0));
  const openSettings = useCallback(() => {
    wentToSettings.current = true;
    const toLocationSwitch =
      permissionIssue === 'unavailable' && Platform.OS === 'android';
    Promise.resolve(
      toLocationSwitch
        ? Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS')
        : Linking.openSettings(),
    ).catch(() =>
      Promise.resolve(Linking.openSettings()).catch(() => undefined),
    );
  }, [permissionIssue]);

  // Back from Settings: look again, so the map follows without another tap.
  useEffect(() => {
    if (!permissionIssue) {
      return;
    }
    const sub = AppState.addEventListener('change', next => {
      if (next === 'active' && wentToSettings.current) {
        wentToSettings.current = false;
        refresh();
      }
    });
    return () => sub.remove();
  }, [permissionIssue, refresh]);
  const showPermissionCard =
    !busy && permissionIssue !== null && !permissionDismissed;
  const activeFilters = countActiveFilters(filters);
  const cardBottom = spacing.xl + insets.bottom * 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <View style={styles.headerSide}>
          <Pressable
            onPress={() => nav.navigate('Notifications')}
            hitSlop={14}
            accessibilityRole="button"
            accessibilityLabel={
              unread ? 'Notifications, unread' : 'Notifications'
            }
            testID="open-notifications"
            style={styles.bell}>
            <Icon name="bell" size={22} color="#FFFFFF" />
            {unread && <View style={styles.unread} />}
          </Pressable>
        </View>
        <Text style={styles.title} accessibilityRole="header">
          Find a Charger
        </Text>
        <View style={[styles.headerSide, styles.headerRight]}>
          <LogoTile />
        </View>
      </View>

      <View style={[styles.searchBox, elevation(1)]}>
        <Icon name="search" size={18} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() =>
            nav.navigate('StationList', {query: query.trim()})
          }
          placeholder="Search location, city or charger name"
          placeholderTextColor={colors.placeholder}
          style={styles.searchInput}
          returnKeyType="search"
          autoCorrect={false}
          clearButtonMode="while-editing"
          accessibilityLabel="Search chargers"
        />
      </View>

      <View style={styles.chipsRow}>
        {QUICK_FILTERS.map(f => {
          const active = f === quick;
          return (
            <Pressable
              key={f}
              onPress={() => setQuick(f)}
              hitSlop={slopFor(36)}
              accessibilityRole="button"
              accessibilityState={{selected: active}}
              style={({pressed}) => [
                styles.chip,
                active && styles.chipActive,
                pressed && !active && styles.chipPressed,
              ]}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {f}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.map}>
        <OfflineBanner />
        <View style={styles.flex}>
          {mapsKeyMissing ? (
            <MapUnavailable onViewList={() => nav.navigate('StationList')} />
          ) : (
            <ChargerMap
              key={mapAttempt}
              ref={mapRef}
              initialCenter={origin}
              chargers={visible}
              vehicle={vehicle}
              selectedId={selected?.id ?? null}
              showUserLocation={userLocation !== null}
              onSelect={select}
              onDeselect={deselect}
              onCenterChange={setMapCenter}
              onReady={onMapReady}
            />
          )}

          <View style={styles.overlayTop} pointerEvents="box-none">
            <VehicleSelector tone="light" />

            {busy && (
              <View
                style={[styles.pill, elevation(1)]}
                accessibilityRole="alert">
                <ActivityIndicator size="small" color={colors.limeDark} />
                <Text style={styles.pillText}>
                  {phase === 'locating'
                    ? 'Finding your location…'
                    : 'Finding chargers nearby…'}
                </Text>
              </View>
            )}

            {showSearchHere && (
              <Pressable
                onPress={searchHere}
                accessibilityRole="button"
                style={({pressed}) => [
                  styles.pill,
                  styles.pillAction,
                  elevation(1),
                  pressed && styles.pillPressed,
                ]}>
                <Text style={styles.pillText}>Search this area</Text>
              </Pressable>
            )}

            {mapStatus === 'failed' && !mapsKeyMissing && (
              <View
                style={[styles.notice, elevation(1)]}
                accessibilityRole="alert">
                <Text style={styles.noticeText}>
                  {Platform.OS === 'android'
                    ? 'The map is taking too long to load. Check your connection and Google Play services.'
                    : 'The map is taking too long to load. Check your connection.'}
                </Text>
                <Pressable
                  onPress={retryMap}
                  hitSlop={14}
                  accessibilityRole="button"
                  accessibilityLabel="Reload map">
                  <Text style={styles.noticeAction}>Reload</Text>
                </Pressable>
              </View>
            )}

            {!busy && notice && !showPermissionCard && (
              <View
                style={[styles.notice, elevation(1)]}
                accessibilityRole="alert">
                <Text style={styles.noticeText}>{notice.message}</Text>
                {canRetry && (
                  <Pressable
                    onPress={retryLocation}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="Try again">
                    <Text style={styles.noticeAction}>Retry</Text>
                  </Pressable>
                )}
              </View>
            )}

            {!busy && !notice && visible.length === 0 && (
              <View style={[styles.pill, elevation(1)]}>
                <Text style={styles.pillText}>
                  {stations.length === 0
                    ? `No ${vehicle ? 'compatible ' : ''}chargers found nearby`
                    : 'No chargers match your filters'}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.mapButtons} pointerEvents="box-none">
            {!mapsKeyMissing && (
              <Pressable
                onPress={recenter}
                accessibilityRole="button"
                accessibilityLabel="Go to my location"
                style={({pressed}) => [
                  styles.mapBtn,
                  elevation(2),
                  pressed && styles.pillPressed,
                ]}>
                <Icon name="locate-fixed" size={20} color={colors.ink} />
              </Pressable>
            )}
            <Pressable
              onPress={() => nav.navigate('Filters')}
              accessibilityRole="button"
              accessibilityLabel={
                activeFilters > 0
                  ? `Filters, ${activeFilters} active`
                  : 'Filters'
              }
              style={({pressed}) => [
                styles.mapBtn,
                elevation(2),
                pressed && styles.pillPressed,
              ]}>
              <Icon name="sliders-horizontal" size={20} color={colors.ink} />
              {activeFilters > 0 && (
                <View style={styles.filterBadge}>
                  <Text style={styles.filterBadgeText}>{activeFilters}</Text>
                </View>
              )}
            </Pressable>
          </View>

          {showPermissionCard && permissionIssue && (
            <View style={[styles.permissionDock, {bottom: cardBottom}]}>
              <LocationPermissionState
                kind={permissionIssue}
                onRetry={retryLocation}
                onOpenSettings={
                  permissionIssue === 'no-fix' ? undefined : openSettings
                }
                settingsFirst={settingsFirst}
                onDismiss={() => setPermissionDismissed(true)}
              />
            </View>
          )}

          {selected && !showPermissionCard && !mapsKeyMissing ? (
            <MapChargerCard
              station={selected}
              vehicle={vehicle}
              now={now}
              best={selected.id === best?.id}
              bottom={cardBottom}
              onClose={deselect}
              onDetails={() =>
                nav.navigate('StationDetail', {stationId: selected.id})
              }
              onDirections={() =>
                nav.navigate('Navigation', {stationId: selected.id})
              }
            />
          ) : (
            visible.length > 0 &&
            !mapsKeyMissing &&
            !showPermissionCard && (
              <Pressable
                onPress={() => nav.navigate('StationList')}
                accessibilityRole="button"
                accessibilityLabel={`View list of ${visible.length} chargers`}
                testID="view-list"
                style={({pressed}) => [
                  styles.listPill,
                  elevation(3),
                  pressed && styles.pillPressed,
                ]}>
                <Icon name="layers" size={16} color={colors.lime} />
                <Text style={styles.listPillText}>
                  {visible.length} charger{visible.length === 1 ? '' : 's'} •
                  View list
                </Text>
              </Pressable>
            )
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  safe: {flex: 1, backgroundColor: colors.bg},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  headerSide: {width: 40, height: 32, justifyContent: 'center'},
  headerRight: {alignItems: 'flex-end'},
  title: {flex: 1, textAlign: 'center', color: '#FFFFFF', ...type.title},
  bell: {width: 24, height: 24, alignItems: 'center', justifyContent: 'center'},
  unread: {
    position: 'absolute',
    top: -2,
    right: -3,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.lime,
    borderWidth: 1.5,
    borderColor: colors.bg,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    marginHorizontal: spacing.xl,
    paddingHorizontal: spacing.lg,
    height: 52,
  },
  searchInput: {flex: 1, fontSize: 14, color: colors.ink, paddingVertical: 0},
  chipsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    gap: 10,
  },
  chip: {
    paddingHorizontal: 18,
    height: 36,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: {backgroundColor: colors.lime, borderColor: colors.lime},
  chipPressed: {backgroundColor: colors.bgRaised},
  chipText: {color: colors.chipText, fontSize: 14, fontWeight: '600'},
  chipTextActive: {color: colors.ink, fontWeight: '800'},
  map: {
    flex: 1,
    backgroundColor: colors.mapBg,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    overflow: 'hidden',
  },
  overlayTop: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.lg,
    right: 72,
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    height: 38,
    borderRadius: radii.pill,
  },
  pillAction: {backgroundColor: colors.lime},
  pillPressed: {opacity: 0.85},
  pillText: {color: colors.ink, fontSize: 13, fontWeight: '700'},
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radii.md,
  },
  noticeText: {
    flexShrink: 1,
    color: colors.inkSoft,
    fontSize: 12.5,
    fontWeight: '600',
  },
  noticeAction: {color: colors.limeDark, fontSize: 13, fontWeight: '800'},
  mapButtons: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.lg,
    gap: spacing.sm,
  },
  mapBtn: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeText: {...type.micro, color: colors.ink},
  // Same slot as the charger card, which steps aside while this is showing.
  permissionDock: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
  },
  listPill: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.pill,
    backgroundColor: colors.bg,
  },
  listPillText: {...type.label, color: '#FFFFFF'},
});

export default HomeScreen;
