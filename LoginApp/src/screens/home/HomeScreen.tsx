import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import ChargerMap, {ChargerMapHandle} from '../../components/ChargerMap';
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

  const busy = phase !== 'ready';
  const showSearchHere =
    !busy && mapCenter !== null && distanceKm(mapCenter, origin) > RESEARCH_KM;
  const canRetry =
    notice?.kind === 'location-denied' ||
    notice?.kind === 'location-unavailable' ||
    notice?.kind === 'search-failed' ||
    notice?.kind === 'offline';
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
          <ChargerMap
            ref={mapRef}
            initialCenter={origin}
            chargers={visible}
            vehicle={vehicle}
            selectedId={selected?.id ?? null}
            showUserLocation={userLocation !== null}
            onSelect={select}
            onDeselect={deselect}
            onCenterChange={setMapCenter}
          />

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

            {!busy && notice && (
              <View
                style={[styles.notice, elevation(1)]}
                accessibilityRole="alert">
                <Text style={styles.noticeText}>{notice.message}</Text>
                {canRetry && (
                  <Pressable
                    onPress={refresh}
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

          {selected ? (
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
            visible.length > 0 && (
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
