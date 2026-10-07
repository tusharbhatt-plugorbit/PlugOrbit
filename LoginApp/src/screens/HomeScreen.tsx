import React, {useMemo, useState} from 'react';
import {
  Image,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

type Filter = 'All' | 'Fast' | 'Available' | 'Near me';

type Charger = {
  id: string;
  name: string;
  distanceKm: number;
  hours: string;
  powerKw: number;
  available: number;
  total: number;
  pricePerKwh: number;
  // Pin position on the map, as a percentage of the map area.
  x: number;
  y: number;
};

const FILTERS: Filter[] = ['All', 'Fast', 'Available', 'Near me'];
const FAST_KW = 50;
const NEAR_KM = 3;

const CHARGERS: Charger[] = [
  {id: '1', name: 'PlugOrbit Charge Hub', distanceKm: 2.4, hours: 'Open 24/7', powerKw: 250, available: 4, total: 6, pricePerKwh: 18, x: 22, y: 28},
  {id: '2', name: 'Orbit Metro Station', distanceKm: 1.1, hours: 'Open 6am-11pm', powerKw: 60, available: 2, total: 4, pricePerKwh: 16, x: 47, y: 46},
  {id: '3', name: 'Green Park Chargers', distanceKm: 4.8, hours: 'Open 24/7', powerKw: 22, available: 0, total: 4, pricePerKwh: 14, x: 12, y: 70},
  {id: '4', name: 'Lakeside Fast Point', distanceKm: 5.6, hours: 'Open 24/7', powerKw: 120, available: 3, total: 8, pricePerKwh: 20, x: 80, y: 62},
  {id: '5', name: 'City Mall Charging', distanceKm: 3.7, hours: 'Open 10am-10pm', powerKw: 30, available: 1, total: 2, pricePerKwh: 17, x: 78, y: 20},
];

const c = {
  bg: '#0B1220',
  surface: '#FFFFFF',
  lime: '#A2F067',
  limeText: '#3F8F12',
  ink: '#0F172A',
  muted: '#64748B',
  chipBorder: '#334155',
  chipText: '#E2E8F0',
  mapBg: '#EEF1F4',
  road: '#FFFFFF',
  roadMinor: '#E2E6EB',
  park: '#D9EBD2',
  water: '#CFE3F2',
};

const LOGO_MARK = require('../../assets/brand/logo-mark.png');

function matchesFilter(charger: Charger, filter: Filter): boolean {
  switch (filter) {
    case 'Fast':
      return charger.powerKw >= FAST_KW;
    case 'Available':
      return charger.available > 0;
    case 'Near me':
      return charger.distanceKm <= NEAR_KM;
    default:
      return true;
  }
}

// Stylised street map drawn with plain views, so no map SDK or API key is needed.
function MapBackdrop(): React.JSX.Element {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[styles.park, {left: '58%', top: '4%', width: '16%', height: '16%'}]} />
      <View style={[styles.park, {left: '2%', top: '55%', width: '24%', height: '22%'}]} />
      <View style={[styles.park, {left: '60%', top: '70%', width: '22%', height: '14%'}]} />
      <View style={[styles.water, {left: '40%', top: '-10%', width: '5%', height: '125%', transform: [{rotate: '18deg'}]}]} />
      <View style={[styles.road, {left: '-10%', top: '38%', width: '120%', transform: [{rotate: '-14deg'}]}]} />
      <View style={[styles.road, {left: '-10%', top: '72%', width: '120%', transform: [{rotate: '8deg'}]}]} />
      <View style={[styles.roadV, {left: '30%', transform: [{rotate: '6deg'}]}]} />
      <View style={[styles.roadV, {left: '68%', transform: [{rotate: '-4deg'}]}]} />
      <View style={[styles.roadMinor, {left: '-10%', top: '18%', width: '120%', transform: [{rotate: '-6deg'}]}]} />
      <View style={[styles.roadMinor, {left: '-10%', top: '56%', width: '120%', transform: [{rotate: '-20deg'}]}]} />
      <View style={[styles.roadMinorV, {left: '14%'}]} />
      <View style={[styles.roadMinorV, {left: '88%'}]} />
    </View>
  );
}

type PinProps = {
  charger: Charger;
  selected: boolean;
  onPress: () => void;
};

function Pin({charger, selected, onPress}: PinProps): React.JSX.Element {
  const size = selected ? 38 : 32;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={`${charger.name}, ${charger.available} of ${charger.total} available`}
      style={[styles.pinWrap, {left: `${charger.x}%`, top: `${charger.y}%`}]}>
      <View
        style={[
          styles.pinHead,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: selected ? c.lime : c.bg,
            borderColor: selected ? c.limeText : c.bg,
          },
        ]}>
        <Text style={[styles.pinGlyph, {color: selected ? c.ink : c.lime}]}>⚡</Text>
      </View>
      <View
        style={[
          styles.pinTip,
          {borderTopColor: selected ? c.limeText : c.bg},
        ]}
      />
    </Pressable>
  );
}

type HomeScreenProps = {
  onBack?: () => void;
};

function HomeScreen({onBack}: HomeScreenProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('All');
  const [selectedId, setSelectedId] = useState<string | null>('1');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CHARGERS.filter(
      ch => matchesFilter(ch, filter) && (!q || ch.name.toLowerCase().includes(q)),
    );
  }, [query, filter]);

  // Hide the card if the selected charger was filtered out.
  const selected = visible.find(ch => ch.id === selectedId) ?? null;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.headerSide}>
          <Text style={styles.backArrow}>←</Text>
        </Pressable>
        <Text style={styles.title}>Find a Charger</Text>
        <View style={[styles.headerSide, styles.headerRight]}>
          <Image source={LOGO_MARK} style={styles.headerLogo} resizeMode="contain" />
        </View>
      </View>

      <View style={styles.searchBox}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search location, city or charger name"
          placeholderTextColor="#94A3B8"
          style={styles.searchInput}
          returnKeyType="search"
          autoCorrect={false}
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
              style={[styles.chip, active && styles.chipActive]}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{f}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.map}>
        <MapBackdrop />
        {visible.map(ch => (
          <Pin
            key={ch.id}
            charger={ch}
            selected={ch.id === selected?.id}
            onPress={() => setSelectedId(ch.id)}
          />
        ))}
        {visible.length === 0 && (
          <View style={styles.emptyBadge}>
            <Text style={styles.emptyText}>No chargers match your search</Text>
          </View>
        )}

        {selected && (
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <View style={styles.thumb}>
                <Text style={styles.thumbGlyph}>🔌</Text>
              </View>
              <View style={styles.cardInfo}>
                <Text style={styles.cardTitle} numberOfLines={1}>{selected.name}</Text>
                <Text style={styles.cardLine}>
                  📍 {selected.distanceKm} km  •  {selected.hours}
                </Text>
                <Text style={styles.cardLine}>
                  ⚡ {selected.powerKw} kW  •  {selected.available}/{selected.total} available
                </Text>
              </View>
              <Pressable
                onPress={() => setSelectedId(null)}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Close">
                <Text style={styles.close}>✕</Text>
              </Pressable>
            </View>

            <View style={styles.priceRow}>
              <View
                style={[
                  styles.statusPill,
                  selected.available === 0 && styles.statusPillBusy,
                ]}>
                <Text
                  style={[
                    styles.statusText,
                    selected.available === 0 && styles.statusTextBusy,
                  ]}>
                  {selected.available > 0 ? 'Available' : 'Busy'}
                </Text>
              </View>
              <Text style={styles.price}>₹{selected.pricePerKwh}/kWh</Text>
            </View>

            <Pressable
              accessibilityRole="button"
              style={({pressed}) => [styles.directions, pressed && {opacity: 0.85}]}>
              <Text style={styles.directionsText}>➤  Directions</Text>
            </Pressable>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: c.bg},

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  headerSide: {width: 40},
  headerRight: {alignItems: 'flex-end'},
  backArrow: {color: '#FFFFFF', fontSize: 24, fontWeight: '600'},
  title: {
    flex: 1,
    textAlign: 'center',
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  headerLogo: {width: 24, height: 24, tintColor: c.lime},

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.surface,
    borderRadius: 16,
    marginHorizontal: 20,
    paddingHorizontal: 14,
    height: 52,
  },
  searchIcon: {fontSize: 15, marginRight: 10},
  searchInput: {flex: 1, fontSize: 14, color: c.ink, paddingVertical: 0},

  chipsRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 10,
  },
  chip: {
    paddingHorizontal: 18,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: c.chipBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: {backgroundColor: c.lime, borderColor: c.lime},
  chipText: {color: c.chipText, fontSize: 14, fontWeight: '600'},
  chipTextActive: {color: c.ink, fontWeight: '800'},

  map: {
    flex: 1,
    backgroundColor: c.mapBg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  park: {position: 'absolute', backgroundColor: c.park, borderRadius: 10},
  water: {position: 'absolute', backgroundColor: c.water},
  road: {position: 'absolute', height: 10, backgroundColor: c.road},
  roadV: {position: 'absolute', top: '-5%', height: '110%', width: 10, backgroundColor: c.road},
  roadMinor: {position: 'absolute', height: 4, backgroundColor: c.roadMinor},
  roadMinorV: {position: 'absolute', top: 0, bottom: 0, width: 4, backgroundColor: c.roadMinor},

  pinWrap: {position: 'absolute', alignItems: 'center', marginLeft: -19, marginTop: -46},
  pinHead: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: {width: 0, height: 2},
    elevation: 4,
  },
  pinGlyph: {fontSize: 14},
  pinTip: {
    width: 0,
    height: 0,
    marginTop: -2,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },

  emptyBadge: {
    alignSelf: 'center',
    marginTop: 24,
    backgroundColor: c.surface,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  emptyText: {color: c.muted, fontSize: 13, fontWeight: '600'},

  card: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 20,
    backgroundColor: c.surface,
    borderRadius: 20,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: {width: 0, height: 6},
    elevation: 8,
  },
  cardTop: {flexDirection: 'row', alignItems: 'flex-start'},
  thumb: {
    width: 62,
    height: 62,
    borderRadius: 12,
    backgroundColor: '#E7F7F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbGlyph: {fontSize: 26},
  cardInfo: {flex: 1, marginHorizontal: 12},
  cardTitle: {color: c.ink, fontSize: 16, fontWeight: '800', marginBottom: 4},
  cardLine: {color: '#334155', fontSize: 12.5, marginTop: 2},
  close: {color: c.ink, fontSize: 16, fontWeight: '700'},

  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 14,
  },
  statusPill: {
    backgroundColor: '#E3F6D5',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginRight: 12,
  },
  statusPillBusy: {backgroundColor: '#FDE4E4'},
  statusText: {color: c.limeText, fontSize: 12, fontWeight: '800'},
  statusTextBusy: {color: '#B42318'},
  price: {color: c.ink, fontSize: 15, fontWeight: '800'},

  directions: {
    height: 50,
    borderRadius: 14,
    backgroundColor: c.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  directionsText: {color: '#FFFFFF', fontSize: 15, fontWeight: '700'},
});

export default HomeScreen;
