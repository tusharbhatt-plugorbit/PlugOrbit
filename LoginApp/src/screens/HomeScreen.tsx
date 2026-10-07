import React, {useCallback, useMemo, useState} from 'react';
import {
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
import ChargerPin from '../components/ChargerPin';
import {BackIcon, SearchIcon} from '../components/Icons';
import MapBackdrop from '../components/MapBackdrop';
import {CHARGERS, FILTERS, Filter, matchesFilter} from '../data/chargers';
import {colors, elevation, radii, spacing} from '../theme';

const LOGO_MARK = require('../../assets/brand/logo-mark.png');

type HomeScreenProps = {
  onBack?: () => void;
};

function HomeScreen({onBack}: HomeScreenProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('All');
  const [selectedId, setSelectedId] = useState<string | null>('1');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CHARGERS.filter(
      ch =>
        matchesFilter(ch, filter) && (!q || ch.name.toLowerCase().includes(q)),
    );
  }, [query, filter]);

  // The card hides if the selected charger was filtered out.
  const selected = useMemo(
    () => visible.find(ch => ch.id === selectedId) ?? null,
    [visible, selectedId],
  );

  const closeCard = useCallback(() => setSelectedId(null), []);

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
        <MapBackdrop />

        {visible.map(ch => (
          <ChargerPin
            key={ch.id}
            charger={ch}
            selected={ch.id === selected?.id}
            onSelect={setSelectedId}
          />
        ))}

        {visible.length === 0 && (
          <View style={[styles.emptyBadge, elevation(1)]}>
            <Text style={styles.emptyText}>No chargers match your search</Text>
          </View>
        )}

        {selected && (
          <ChargerCard
            charger={selected}
            bottomInset={insets.bottom}
            onClose={closeCard}
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
  emptyBadge: {
    alignSelf: 'center',
    marginTop: spacing.xl,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radii.pill,
  },
  emptyText: {color: colors.muted, fontSize: 13, fontWeight: '600'},
});

export default HomeScreen;
