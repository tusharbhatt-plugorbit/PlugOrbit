import React, {useMemo} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {ALL_AMENITIES, AMENITY_LABEL} from '../../domain/discover';
import {
  DEFAULT_FILTERS,
  applyFilters,
  compatibleConnectors,
  countActiveFilters,
  isCompatible,
} from '../../domain/rules';
import type {Amenity, ConnectorType, StationFilters} from '../../domain/types';
import {useDiscoverStations} from '../../hooks/useDiscoverStations';
import {useNavigation} from '../../navigation/NavigationContext';
import {appStore, selectActiveVehicle, useApp} from '../../store/appStore';
import {colors, spacing, type} from '../../theme';
import {
  Card,
  Chip,
  ListCard,
  Notice,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionTitle,
  Skeleton,
  TextButton,
  ToggleRow,
  showToast,
  typeLabel,
  vehicleName,
} from '../../ui';
import {AMENITY_ICON} from '../../ui/DiscoverParts';

const SPEEDS: ReadonlyArray<{kw: number; label: string}> = [
  {kw: 0, label: 'Any'},
  {kw: 22, label: '22+ kW'},
  {kw: 50, label: '50+ kW'},
  {kw: 100, label: '100+ kW'},
];

const PRICES: ReadonlyArray<{max: number | null; label: string}> = [
  {max: null, label: 'Any'},
  {max: 14, label: 'Up to ₹14'},
  {max: 16, label: 'Up to ₹16'},
  {max: 18, label: 'Up to ₹18'},
  {max: 20, label: 'Up to ₹20'},
];

const CONNECTOR_ORDER: readonly ConnectorType[] = [
  'CCS2',
  'Type2',
  'CHAdeMO',
  'GBT',
  'LECCS',
];

function update(patch: Partial<StationFilters>) {
  appStore.set(s => ({filters: {...s.filters, ...patch}}));
}

function FilterGroup({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <View>
      <SectionTitle title={title} />
      <Card>
        <View style={styles.chips}>{children}</View>
        {caption ? <Text style={styles.caption}>{caption}</Text> : null}
      </Card>
    </View>
  );
}

/** 05 Filters. Changes apply immediately and the count updates live. */
export default function FiltersScreen(): React.JSX.Element {
  const nav = useNavigation();
  const vehicle = useApp(selectActiveVehicle);
  const filters = useApp(s => s.filters);
  const resource = useDiscoverStations(vehicle);
  const active = countActiveFilters(filters);

  const stations = resource.data?.stations ?? null;
  const matching = useMemo(
    () => (stations ? applyFilters(stations, filters, vehicle).length : null),
    [stations, filters, vehicle],
  );
  const pool = useMemo(() => {
    if (!stations) {
      return null;
    }
    return filters.includeIncompatible || !vehicle
      ? stations.length
      : stations.filter(s => isCompatible(s, vehicle)).length;
  }, [stations, filters.includeIncompatible, vehicle]);

  // Only offer connector types that exist nearby and that the car can use
  // (unless the driver chose to see incompatible chargers too).
  const connectorTypes = useMemo(() => {
    const seen = new Set<ConnectorType>();
    (stations ?? []).forEach(s => {
      const list =
        filters.includeIncompatible || !vehicle
          ? s.connectors
          : compatibleConnectors(s, vehicle);
      list.forEach(c => seen.add(c.type));
    });
    if (seen.size === 0) {
      (vehicle?.connectors ?? ['CCS2', 'Type2']).forEach(t => seen.add(t));
    }
    if (filters.connector !== 'any') {
      seen.add(filters.connector);
    }
    return CONNECTOR_ORDER.filter(t => seen.has(t));
  }, [stations, vehicle, filters.includeIncompatible, filters.connector]);

  const toggleAmenity = (a: Amenity) =>
    update({
      amenities: filters.amenities.includes(a)
        ? filters.amenities.filter(x => x !== a)
        : [...filters.amenities, a],
    });

  const reset = () => {
    appStore.set({filters: DEFAULT_FILTERS});
    showToast('Filters reset', 'info');
  };

  const loading = resource.data === null && resource.status === 'loading';
  const failed = resource.data === null && !loading;
  const empty = matching === 0;

  return (
    <Screen
      title="Filters"
      footer={
        <View style={styles.footer}>
          <SecondaryButton
            label="Reset"
            icon="refresh-cw"
            disabled={active === 0}
            onPress={reset}
            style={styles.resetBtn}
          />
          <PrimaryButton
            label={
              matching === null
                ? 'Show chargers'
                : empty
                ? 'No chargers match'
                : `Show ${matching} charger${matching === 1 ? '' : 's'}`
            }
            disabled={empty}
            onPress={nav.goBack}
            style={styles.showBtn}
          />
        </View>
      }>
      <View style={styles.stack}>
        <Card tone={empty ? 'warn' : 'lime'} testID="filter-summary">
          {loading ? (
            <View style={styles.summarySkeleton}>
              <Skeleton height={34} width="30%" />
              <Skeleton height={12} width="60%" />
            </View>
          ) : failed ? (
            <Notice
              tone="warn"
              title="Couldn’t count chargers"
              body="Your filters are saved and will still apply to the list."
              action={
                <TextButton
                  label="Try again"
                  icon="refresh-cw"
                  onPress={resource.reload}
                />
              }
            />
          ) : (
            <View
              style={styles.summary}
              accessible
              accessibilityLabel={`${matching} of ${pool} chargers match`}>
              <Text style={styles.summaryCount}>{matching}</Text>
              <View style={styles.flex}>
                <Text style={styles.summaryTitle}>
                  {matching === 1 ? 'charger matches' : 'chargers match'}
                </Text>
                <Text style={styles.summarySub}>
                  {empty
                    ? 'Loosen a filter to see more.'
                    : `of ${pool} ${
                        vehicle && !filters.includeIncompatible
                          ? 'compatible '
                          : ''
                      }${
                        resource.data?.demoArea
                          ? 'around New Delhi'
                          : 'near you'
                      }`}
                </Text>
              </View>
            </View>
          )}
        </Card>

        <View>
          <SectionTitle title="Availability" />
          <ListCard>
            <ToggleRow
              title="Available now only"
              subtitle="Hide chargers where every compatible bay is busy or offline"
              value={filters.availableOnly}
              onValueChange={v => update({availableOnly: v})}
              last
            />
          </ListCard>
        </View>

        <FilterGroup
          title="Connector"
          caption={
            vehicle
              ? `Your ${vehicleName(vehicle)} uses ${vehicle.connectors.join(
                  ' or ',
                )}.`
              : undefined
          }>
          <Chip
            label="Any"
            selected={filters.connector === 'any'}
            onPress={() => update({connector: 'any'})}
          />
          {connectorTypes.map(t => (
            <Chip
              key={t}
              label={typeLabel(t)}
              selected={filters.connector === t}
              onPress={() => update({connector: t})}
            />
          ))}
        </FilterGroup>

        <FilterGroup
          title="Speed"
          caption={
            vehicle
              ? `Your ${vehicleName(vehicle)} charges at up to ${
                  vehicle.maxDcKw
                } kW on DC, so faster chargers won’t speed it up.`
              : 'Minimum charger power.'
          }>
          {SPEEDS.map(o => (
            <Chip
              key={o.kw}
              label={o.label}
              selected={filters.minPowerKw === o.kw}
              onPress={() => update({minPowerKw: o.kw})}
            />
          ))}
        </FilterGroup>

        <FilterGroup
          title="Price per kWh"
          caption="Chargers that don’t publish a price stay in the list, marked as such.">
          {PRICES.map(o => (
            <Chip
              key={o.label}
              label={o.label}
              selected={filters.maxPricePerKwh === o.max}
              onPress={() => update({maxPricePerKwh: o.max})}
            />
          ))}
        </FilterGroup>

        <FilterGroup
          title="Amenities"
          caption="Chargers must have all the amenities you pick.">
          {ALL_AMENITIES.map(a => (
            <Chip
              key={a}
              label={AMENITY_LABEL[a]}
              icon={AMENITY_ICON[a]}
              selected={filters.amenities.includes(a)}
              onPress={() => toggleAmenity(a)}
            />
          ))}
        </FilterGroup>

        <View>
          <SectionTitle title="Compatibility" />
          <ListCard>
            <ToggleRow
              title="Show incompatible chargers"
              subtitle={
                vehicle
                  ? `Hidden by default so you only see chargers your ${vehicleName(
                      vehicle,
                    )} can use`
                  : 'Add your EV to hide chargers that don’t fit'
              }
              value={filters.includeIncompatible}
              onValueChange={v => update({includeIncompatible: v})}
              last
            />
          </ListCard>
          {filters.includeIncompatible && (
            <View style={styles.warning}>
              <Notice
                tone="warn"
                title="These chargers can’t charge your car"
                body={
                  vehicle
                    ? `They’re marked “Not compatible” and you can’t start a session on them with your ${vehicleName(
                        vehicle,
                      )}.`
                    : 'They’re marked “Not compatible” once you add your vehicle.'
                }
              />
            </View>
          )}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  stack: {gap: spacing.md},
  chips: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
  caption: {...type.caption, color: colors.muted, marginTop: spacing.md},
  summary: {flexDirection: 'row', alignItems: 'center', gap: spacing.lg},
  summaryCount: {...type.brand, color: colors.ink, minWidth: 40},
  summaryTitle: {...type.heading, color: colors.ink},
  summarySub: {...type.caption, color: colors.inkSoft, marginTop: 2},
  summarySkeleton: {gap: spacing.sm},
  warning: {marginTop: spacing.md},
  footer: {flexDirection: 'row', gap: spacing.md},
  resetBtn: {flex: 1},
  showBtn: {flex: 2},
});
