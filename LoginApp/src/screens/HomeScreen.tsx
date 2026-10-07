import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import ChargerCard from '../components/ChargerCard';
import ChargerMap, {ChargerMapHandle} from '../components/ChargerMap';
import {BackIcon, LocateIcon, SearchIcon} from '../components/Icons';
import {FILTERS, Filter, matchesFilter} from '../data/chargers';
import type {ChargerWithDistance} from '../data/chargers';
import {useNearbyChargers} from '../hooks/useNearbyChargers';
import {openDirections} from '../services/directions';
import {colors, elevation, radii, spacing} from '../theme';
import {Coords, distanceKm} from '../utils/geo';

const LOGO_MARK = require('../../assets/brand/logo-mark.png');

// Offer "Search this area" once the map has been panned this far from the
// point the current results were centred on.
const RESEARCH_KM = 2;

type HomeScreenProps = {
  onBack?: () => void;
};

function HomeScreen({onBack}: HomeScreenProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<ChargerMapHandle>(null);
  const {status, chargers, userLocation, origin, notice, refresh, searchAt} =
    useNearbyChargers();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('All');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapCenter, setMapCenter] = useState<Coords | null>(null);
  const autoSelected = useRef(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return chargers.filter(
      ch =>
        matchesFilter(ch, filter) &&
        (!q ||
          ch.name.toLowerCase().includes(q) ||
          (ch.address ?? '').toLowerCase().includes(q)),
    );
  }, [chargers, query, filter]);

  // The card hides if the selected charger was filtered out.
  const selected = useMemo(
    () => visible.find(ch => ch.id === selectedId) ?? null,
    [visible, selectedId],
  );

  // Fly to each new search origin (the device on first load, or "this area").
  useEffect(() => {
    mapRef.current?.animateTo(origin);
    setMapCenter(null);
  }, [origin]);

  // Open the nearest charger once, so the screen lands on something useful.
  useEffect(() => {
    if (status === 'ready' && !autoSelected.current && chargers.length > 0) {
      autoSelected.current = true;
      setSelectedId(chargers[0].id);
    }
  }, [status, chargers]);

  const select = useCallback(
    (id: string) => {
      setSelectedId(id);
      const ch = chargers.find(c => c.id === id);
      if (ch) {
        mapRef.current?.animateTo(ch, true);
      }
    },
    [chargers],
  );
  const deselect = useCallback(() => setSelectedId(null), []);

  const recenter = useCallback(() => {
    if (userLocation) {
      mapRef.current?.animateTo(userLocation);
    } else {
      refresh();
    }
  }, [userLocation, refresh]);

  const directions = useCallback(async (ch: ChargerWithDistance) => {
    if (!(await openDirections(ch))) {
      Alert.alert('Directions', 'Could not open Google Maps.');
    }
  }, []);

  const searchHere = useCallback(() => {
    if (mapCenter) {
      setSelectedId(null);
      searchAt(mapCenter);
    }
  }, [mapCenter, searchAt]);

  const busy = status !== 'ready';
  const showSearchHere =
    !busy && mapCenter !== null && distanceKm(mapCenter, origin) > RESEARCH_KM;
  const canRetry =
    notice?.kind === 'location-denied' ||
    notice?.kind === 'location-unavailable' ||
    notice?.kind === 'search-failed';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          hitSlop={14}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.headerSide}>
          <BackIcon size={22} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          Find a Charger
        </Text>
        <View style={[styles.headerSide, styles.headerRight]}>
          <View style={styles.logoTile}>
            <Image
              source={LOGO_MARK}
              style={styles.logo}
              resizeMode="contain"
              accessibilityLabel="PlugOrbit"
            />
          </View>
        </View>
      </View>

      <View style={[styles.searchBox, elevation(1)]}>
        <SearchIcon size={18} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
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
        {FILTERS.map(f => {
          const active = f === filter;
          return (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
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
        <ChargerMap
          ref={mapRef}
          initialCenter={origin}
          chargers={visible}
          selectedId={selected?.id ?? null}
          showUserLocation={userLocation !== null}
          onSelect={select}
          onDeselect={deselect}
          onCenterChange={setMapCenter}
        />

        <View style={styles.overlayTop} pointerEvents="box-none">
          {busy && (
            <View style={[styles.pill, elevation(1)]} accessibilityRole="alert">
              <ActivityIndicator size="small" color={colors.limeDark} />
              <Text style={styles.pillText}>
                {status === 'locating'
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
              <Text style={styles.pillText}>No chargers match your search</Text>
            </View>
          )}
        </View>

        <Pressable
          onPress={recenter}
          accessibilityRole="button"
          accessibilityLabel="Go to my location"
          style={({pressed}) => [
            styles.locate,
            elevation(2),
            pressed && styles.pillPressed,
          ]}>
          <LocateIcon size={20} color={colors.ink} />
        </Pressable>

        {selected && (
          <ChargerCard
            charger={selected}
            bottomInset={insets.bottom}
            onClose={deselect}
            onDirections={directions}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
  title: {
    flex: 1,
    textAlign: 'center',
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  logoTile: {
    width: 32,
    height: 32,
    borderRadius: 9,
    padding: 5,
    backgroundColor: '#FFFFFF',
  },
  logo: {width: '100%', height: '100%'},

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

  locate: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.lg,
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default HomeScreen;
