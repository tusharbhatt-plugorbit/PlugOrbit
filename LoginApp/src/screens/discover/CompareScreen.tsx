import React, {useMemo} from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {bestEffectiveKw, comparePicks, PickResult} from '../../domain/discover';
import {
  CONFIDENCE_LABEL,
  availableCount,
  compatibleConnectors,
  lowestPrice,
  stationHealth,
  waitLabel,
} from '../../domain/rules';
import {dataTrust, timeAgo} from '../../domain/trust';
import type {StationWithDistance, WaitEstimate} from '../../domain/types';
import {loadStationsById} from '../../hooks/useDiscoverStations';
import {useNavigation, useRoute} from '../../navigation/NavigationContext';
import {useServices} from '../../services';
import {selectActiveVehicle, useApp} from '../../store/appStore';
import {colors, elevation, radii, sizes, spacing, type} from '../../theme';
import {
  AsyncView,
  Card,
  ConfidenceBadge,
  EmptyState,
  Icon,
  IconName,
  ListSkeleton,
  Notice,
  Pill,
  PrimaryButton,
  Screen,
  SecondaryButton,
  StatusBadge,
  TextButton,
  useNow,
  useResource,
  vehicleName,
} from '../../ui';
import {formatInr} from '../../utils/format';
import {formatDistance} from '../../utils/geo';

const MAX_COMPARE = 3;

type CompareData = {
  stations: StationWithDistance[];
  waits: Record<string, WaitEstimate | null>;
  missing: number;
  fromCache: boolean;
};

const HEALTH_TO_STATUS = {
  available: 'available',
  busy: 'occupied',
  offline: 'offline',
  unknown: 'unknown',
} as const;

/** Indices holding the best value; nobody is highlighted when all tie. */
function bestIndices(
  values: ReadonlyArray<number | null>,
  better: 'higher' | 'lower',
): Set<number> {
  const real = values.filter((v): v is number => v !== null);
  if (real.length < 2) {
    return new Set();
  }
  const target = better === 'higher' ? Math.max(...real) : Math.min(...real);
  if (real.every(v => Math.abs(v - target) < 1e-6)) {
    return new Set();
  }
  const out = new Set<number>();
  values.forEach((v, i) => {
    if (v !== null && Math.abs(v - target) < 1e-6) {
      out.add(i);
    }
  });
  return out;
}

function priceAge(s: StationWithDistance, now: number): string {
  const trust = dataTrust(s.priceFeed, now);
  if (trust === 'unknown') {
    return 'No update time';
  }
  const label =
    trust === 'live'
      ? 'Updated'
      : trust === 'user'
      ? 'Driver-confirmed'
      : 'Estimated';
  return `${label} ${timeAgo(s.priceFeed.updatedAt, now)}`;
}

type Cell = {
  value: React.ReactNode;
  sub?: string;
  best?: boolean;
  a11y: string;
};

function MetricRow({
  label,
  cells,
  last,
}: {
  label: string;
  cells: Cell[];
  last?: boolean;
}) {
  return (
    <View style={[styles.metric, !last && styles.metricDivider]}>
      <Text style={styles.metricLabel}>{label}</Text>
      <View style={styles.cols}>
        {cells.map((c, i) => (
          <View
            key={i}
            style={styles.col}
            accessible
            accessibilityLabel={`${label}: ${c.a11y}${c.best ? ', best' : ''}`}>
            <View style={[styles.cellBox, c.best && styles.best]}>
              {typeof c.value === 'string' ? (
                <Text style={styles.cellValue}>{c.value}</Text>
              ) : (
                c.value
              )}
            </View>
            {c.sub ? <Text style={styles.cellSub}>{c.sub}</Text> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

function PickCard({
  icon,
  label,
  result,
  reason,
  tone,
  onOpen,
}: {
  icon: IconName;
  label: string;
  result: PickResult<StationWithDistance>;
  reason: (winner: StationWithDistance) => string;
  tone: 'default' | 'lime';
  onOpen: (s: StationWithDistance) => void;
}) {
  const winner = result.winners[0];
  const names = result.winners.map(w => w.name).join(' and ');
  const title = !winner
    ? 'Not enough data'
    : result.allTied
    ? 'No difference between these chargers'
    : names;
  const body = !winner
    ? 'None of these chargers publish this yet.'
    : result.allTied
    ? reason(winner)
    : result.winners.length > 1
    ? `Tie. ${reason(winner)}`
    : reason(winner);
  const open = winner && !result.allTied ? () => onOpen(winner) : undefined;
  return (
    <Card
      tone={tone}
      onPress={open}
      accessibilityLabel={`${label}: ${title}. ${body}`}>
      <View style={styles.pick}>
        <View style={styles.pickIcon}>
          <Icon name={icon} size={20} color={colors.ink} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.pickLabel}>{label}</Text>
          <Text style={styles.pickTitle} numberOfLines={2}>
            {title}
          </Text>
          <Text style={styles.pickBody}>{body}</Text>
        </View>
        {open && <Icon name="chevron-right" size={18} color={colors.muted} />}
      </View>
    </Card>
  );
}

function CompareBody({
  data,
  refreshing,
  reload,
}: {
  data: CompareData;
  refreshing: boolean;
  reload: () => void;
}) {
  const nav = useNavigation();
  const now = useNow();
  const vehicle = useApp(selectActiveVehicle);
  const {stations, waits} = data;
  const picks = useMemo(
    () => comparePicks(stations, vehicle),
    [stations, vehicle],
  );
  const bestFit = picks.best.winners[0] ?? stations[0];

  const open = (s: StationWithDistance) =>
    nav.navigate('StationDetail', {stationId: s.id});

  const rows: Array<{label: string; cells: Cell[]}> = [];

  rows.push({
    label: 'Status',
    cells: stations.map(s => ({
      value: (
        <View style={styles.statusCell}>
          <StatusBadge status={HEALTH_TO_STATUS[stationHealth(s, vehicle)]} />
          <ConfidenceBadge
            feed={s.statusFeed}
            now={now}
            subject="Status"
            showAge={false}
          />
        </View>
      ),
      sub: `Updated ${timeAgo(s.statusFeed.updatedAt, now)}`,
      a11y: `${stationHealth(s, vehicle)}, updated ${timeAgo(
        s.statusFeed.updatedAt,
        now,
      )}`,
    })),
  });

  const free = stations.map(s => availableCount(s, vehicle));
  const bestFree = bestIndices(free, 'higher');
  rows.push({
    label: 'Free bays',
    cells: stations.map((s, i) => ({
      value: `${free[i]} of ${compatibleConnectors(s, vehicle).length}`,
      sub: vehicle ? 'compatible' : undefined,
      best: bestFree.has(i),
      a11y: `${free[i]} free`,
    })),
  });

  const bestDetour = bestIndices(
    stations.map(s => s.detourMin),
    'lower',
  );
  rows.push({
    label: 'Distance',
    cells: stations.map((s, i) => ({
      value: formatDistance(s.distanceKm),
      sub: `${s.detourMin} min detour`,
      best: bestDetour.has(i),
      a11y: `${formatDistance(s.distanceKm)}, ${s.detourMin} minute detour`,
    })),
  });

  const kw = stations.map(s => bestEffectiveKw(s, vehicle));
  const bestKw = bestIndices(kw, 'higher');
  rows.push({
    label: 'Charging speed',
    cells: stations.map((s, i) => {
      const rated = Math.max(
        ...compatibleConnectors(s, vehicle).map(c => c.powerKw),
        0,
      );
      return {
        value: `${kw[i]} kW`,
        sub: vehicle && rated > kw[i] ? `charger ${rated} kW` : undefined,
        best: bestKw.has(i),
        a11y: `${kw[i]} kilowatts`,
      };
    }),
  });

  const prices = stations.map(s => lowestPrice(s, vehicle));
  const bestPrice = bestIndices(prices, 'lower');
  rows.push({
    label: 'Price',
    cells: stations.map((s, i) => ({
      value:
        prices[i] === null
          ? 'Not published'
          : `${formatInr(
              prices[i] as number,
              (prices[i] as number) % 1 !== 0,
            )}/kWh`,
      sub: priceAge(s, now),
      best: bestPrice.has(i),
      a11y:
        prices[i] === null
          ? 'not published'
          : `${prices[i]} rupees per kilowatt hour, ${priceAge(s, now)}`,
    })),
  });

  const rel = stations.map(s =>
    s.successfulSessionsPct > 0 ? s.successfulSessionsPct : null,
  );
  const bestRel = bestIndices(rel, 'higher');
  rows.push({
    label: 'Reliability',
    cells: stations.map((s, i) => ({
      value: rel[i] === null ? 'No data' : `${rel[i]}%`,
      sub: rel[i] === null ? undefined : 'successful sessions',
      best: bestRel.has(i),
      a11y: rel[i] === null ? 'no data' : `${rel[i]} percent successful`,
    })),
  });

  const waitList = stations.map(s => waits[s.id] ?? null);
  const bestWait = bestIndices(
    waitList.map(w => (w && w.basis !== 'none' ? w.maxMinutes : null)),
    'lower',
  );
  rows.push({
    label: 'Expected wait',
    cells: stations.map((s, i) => {
      const w = waitList[i];
      return {
        value: w ? waitLabel(w) : 'Wait unknown',
        sub:
          w && w.basis !== 'none' ? CONFIDENCE_LABEL[w.confidence] : undefined,
        best: bestWait.has(i),
        a11y: w
          ? `${waitLabel(w)}, ${CONFIDENCE_LABEL[w.confidence]}`
          : 'unknown',
      };
    }),
  });

  return (
    <Screen
      title="Compare chargers"
      scroll={false}
      footer={
        <PrimaryButton
          label="Navigate to best fit"
          icon="navigation"
          onPress={() => nav.navigate('Navigation', {stationId: bestFit.id})}
        />
      }>
      <ScrollView
        style={styles.flex}
        stickyHeaderIndices={[1]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={reload}
            tintColor={colors.limeDark}
          />
        }
        contentContainerStyle={styles.scrollContent}>
        <View style={styles.intro}>
          <Text style={styles.h1} accessibilityRole="header">
            Top picks for your trip
          </Text>
          <Text style={styles.sub}>
            {vehicle
              ? `Based on your ${vehicleName(vehicle)} and the latest data. `
              : 'Based on the latest data. '}
            Sponsored chargers are never boosted.
          </Text>
          {data.fromCache && (
            <Notice
              tone="warn"
              icon="wifi-off"
              title="You’re offline"
              body="Showing the last data we saved. Status and prices may have changed."
              action={
                <TextButton label="Retry" icon="refresh-cw" onPress={reload} />
              }
            />
          )}
          {data.missing > 0 && (
            <Notice
              tone="info"
              title={`${data.missing} charger${
                data.missing === 1 ? '' : 's'
              } couldn’t be loaded`}
              body="It may have been removed. Comparing the rest."
            />
          )}
          <PickCard
            icon="badge-check"
            label="Best fit"
            tone="lime"
            result={picks.best}
            reason={w =>
              `${
                w.successfulSessionsPct > 0
                  ? `${w.successfulSessionsPct}% reliable • `
                  : ''
              }${availableCount(w, vehicle)} bay${
                availableCount(w, vehicle) === 1 ? '' : 's'
              } free • ${w.detourMin} min detour`
            }
            onOpen={open}
          />
          <PickCard
            icon="gauge"
            label="Fastest"
            tone="default"
            result={picks.fastest}
            reason={w =>
              `Up to ${bestEffectiveKw(w, vehicle)} kW${
                vehicle ? ` for your ${vehicle.model}` : ''
              }`
            }
            onOpen={open}
          />
          <PickCard
            icon="indian-rupee"
            label="Cheapest"
            tone="default"
            result={picks.cheapest}
            reason={w => {
              const p = lowestPrice(w, vehicle);
              return p === null
                ? ''
                : `${formatInr(p, p % 1 !== 0)}/kWh • ${priceAge(
                    w,
                    now,
                  ).toLowerCase()}`;
            }}
            onOpen={open}
          />
        </View>

        <View style={styles.headerWrap}>
          <View style={[styles.headerRow, elevation(1)]}>
            {stations.map(s => (
              <Pressable
                key={s.id}
                onPress={() => open(s)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${s.name}`}
                style={styles.headCol}>
                <Text style={styles.headName} numberOfLines={3}>
                  {s.name}
                </Text>
                {s.sponsored && <Pill label="Sponsored" tone="slate" />}
              </Pressable>
            ))}
          </View>
        </View>

        <View style={[styles.table, elevation(1)]}>
          {rows.map(r => (
            <MetricRow key={r.label} label={r.label} cells={r.cells} />
          ))}
          <View style={[styles.metric, styles.actions]}>
            <View style={styles.cols}>
              {stations.map(s => (
                <View key={s.id} style={styles.col}>
                  <PrimaryButton
                    label="Choose"
                    compact
                    onPress={() => open(s)}
                    accessibilityHint={`Open ${s.name}`}
                    style={styles.colBtn}
                  />
                  <SecondaryButton
                    label="Navigate"
                    compact
                    onPress={() =>
                      nav.navigate('Navigation', {stationId: s.id})
                    }
                    accessibilityHint={`Navigate to ${s.name}`}
                    style={styles.colBtn}
                  />
                </View>
              ))}
            </View>
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

/** 07 Compare chargers. */
export default function CompareScreen(): React.JSX.Element {
  const nav = useNavigation();
  const {params} = useRoute<'Compare'>();
  const {station: stationService} = useServices();
  const vehicle = useApp(selectActiveVehicle);
  const ids = useMemo(
    () => [...new Set(params.stationIds)].slice(0, MAX_COMPARE),
    [params.stationIds],
  );
  const resource = useResource<CompareData>(
    async () => {
      const r = await loadStationsById(stationService, ids);
      const waits = await Promise.all(
        r.stations.map(s =>
          stationService.waitEstimate(s.id, vehicle).catch(() => null),
        ),
      );
      return {
        stations: r.stations,
        waits: Object.fromEntries(r.stations.map((s, i) => [s.id, waits[i]])),
        missing: r.missing.length,
        fromCache: r.fromCache,
      };
    },
    [ids.join('|'), vehicle?.id ?? null, stationService],
    {enabled: ids.length >= 2},
  );

  const guide = (
    <EmptyState
      icon="scale"
      title="Pick at least two chargers"
      body="Choose two or three chargers from the list and we’ll line them up side by side."
      primary={{
        label: 'Choose chargers',
        icon: 'search',
        onPress: () => nav.navigate('StationList'),
      }}
    />
  );

  if (ids.length < 2) {
    return <Screen title="Compare chargers">{guide}</Screen>;
  }
  if (resource.data && resource.data.stations.length >= 2) {
    return (
      <CompareBody
        data={resource.data}
        refreshing={resource.refreshing}
        reload={resource.reload}
      />
    );
  }
  return (
    <Screen title="Compare chargers">
      <AsyncView
        resource={resource}
        loading={<ListSkeleton count={3} />}
        errorTitle="Couldn’t compare these chargers"
        errorBody="We couldn’t load them. Check your connection and try again."
        render={() => guide}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  scrollContent: {paddingTop: spacing.xl, paddingBottom: spacing.xxl},
  intro: {gap: spacing.md},
  h1: {...type.h1, color: colors.ink},
  sub: {...type.caption, color: colors.muted, marginTop: -spacing.sm},
  pick: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  pickIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickLabel: {
    ...type.micro,
    color: colors.limeDark,
    textTransform: 'uppercase',
  },
  pickTitle: {...type.heading, color: colors.ink, marginTop: 2},
  pickBody: {...type.caption, color: colors.inkSoft, marginTop: 2},
  headerWrap: {
    marginTop: spacing.xl,
    backgroundColor: colors.body,
    paddingBottom: 1,
  },
  headerRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  headCol: {flex: 1, gap: spacing.xs, minHeight: sizes.tap},
  headName: {...type.label, color: colors.ink},
  table: {
    backgroundColor: colors.surface,
    borderBottomLeftRadius: radii.lg,
    borderBottomRightRadius: radii.lg,
    paddingHorizontal: spacing.md,
  },
  metric: {paddingVertical: spacing.md, gap: spacing.sm},
  metricDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  metricLabel: {...type.micro, color: colors.muted, textTransform: 'uppercase'},
  cols: {flexDirection: 'row', gap: spacing.xs},
  col: {flex: 1, gap: 2, minWidth: 0},
  cellValue: {...type.bodyStrong, color: colors.ink},
  cellSub: {...type.caption, color: colors.muted, fontSize: 11.5},
  // Every value gets the same box so rows stay aligned; "best" only tints it.
  cellBox: {
    alignSelf: 'flex-start',
    borderRadius: radii.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: -6,
  },
  best: {backgroundColor: colors.limeSoft},
  statusCell: {gap: 4},
  actions: {paddingVertical: spacing.lg},
  colBtn: {paddingHorizontal: spacing.sm, marginBottom: spacing.sm},
});
