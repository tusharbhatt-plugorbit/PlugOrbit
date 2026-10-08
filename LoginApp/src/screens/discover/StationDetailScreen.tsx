import React, {useMemo, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {chargeConfidence} from '../../domain/chargeConfidence';
import {whyRecommended} from '../../domain/discover';
import {estimateVehicleCharge} from '../../domain/vehicleCharging';
import {estimateDetourMin, isDemoFallback} from '../../domain/rules';
import {
  availableCount,
  compatibleConnectors,
  hasUnconfirmedConnectors,
  organicScore,
  stationHealth,
  waitBasisLabel,
  waitLabel,
} from '../../domain/rules';
import {toggleFavouriteStation} from '../../domain/favourites';
import {timeAgo} from '../../domain/trust';
import type {
  CommunityUpdate,
  StationWithDistance,
  Vehicle,
  WaitEstimate,
} from '../../domain/types';
import {loadStationsById} from '../../hooks/useDiscoverStations';
import {useNavigation, useRoute} from '../../navigation/NavigationContext';
import {useServices} from '../../services';
import {OfflineError} from '../../services/types';
import {selectActiveVehicle, useApp} from '../../store/appStore';
import {useDemo} from '../../store/demoStore';
import {colors, radii, spacing, type} from '../../theme';
import {
  AsyncView,
  BackupChargerCard,
  CardSkeleton,
  Card,
  ChargeConfidenceCard,
  VehicleChargeCard,
  ConfidencePill,
  ConnectorChip,
  EmptyState,
  ListCard,
  ListRow,
  Notice,
  Pill,
  PrimaryButton,
  Screen,
  SectionTitle,
  Skeleton,
  TextButton,
  showToast,
  useNow,
  useResource,
  vehicleName,
  Icon,
} from '../../ui';
import type {Resource} from '../../ui/useResource';
import {AmenityPills} from '../../ui/DiscoverParts';
import {
  ConnectorPanel,
  OperatorInstructionsCard,
  ReasonsCard,
  StationHero,
} from '../../ui/StationDetailParts';

// `station` is null when the id doesn't resolve right now (see loadStationsById).
type Loaded = {station: StationWithDistance | null; fromCache: boolean};

const NEAREST_COUNT = 5;
// A "backup" further away than this isn't a backup, it's a different trip.
const BACKUP_MAX_KM = 60;

/** Title + content with the same 12px rhythm everywhere. */
function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <SectionTitle title={title} action={action} />
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function errorMessage(e: unknown): string {
  if (e instanceof OfflineError) {
    return 'You’re offline. Try again when you’re back online.';
  }
  return e instanceof Error ? e.message : 'Something went wrong. Try again.';
}

/**
 * Shown when no compatible bay is free. The wait is always a range with a
 * confidence label, never a single minute count.
 */
function WaitCard({
  wait,
  loading,
  joining,
  onJoin,
  disabled,
}: {
  wait: WaitEstimate | null;
  loading: boolean;
  joining: boolean;
  onJoin: () => void;
  disabled: boolean;
}) {
  const basis =
    wait === null
      ? 'We couldn’t estimate the wait just now.'
      : waitBasisLabel(wait);
  return (
    <Card testID="wait-card">
      <View style={styles.waitHead}>
        <View style={styles.waitIcon}>
          <Icon name="hourglass" size={18} color={colors.amber} />
        </View>
        <Text style={styles.waitTitle}>All compatible bays are busy</Text>
      </View>
      <Text style={styles.waitLabel}>Expected wait</Text>
      {loading ? (
        <View style={styles.waitSkeleton}>
          <Skeleton height={26} width="45%" />
          <Skeleton height={12} width="70%" />
        </View>
      ) : (
        <>
          <View style={styles.waitRow}>
            <Text style={styles.waitValue}>
              {wait ? waitLabel(wait) : 'Wait unknown'}
            </Text>
            {wait && <ConfidencePill confidence={wait.confidence} />}
          </View>
          <Text style={styles.waitBasis}>{basis}</Text>
        </>
      )}
      <PrimaryButton
        label="Join queue"
        icon="users"
        compact
        loading={joining}
        disabled={disabled}
        onPress={onJoin}
        style={styles.joinBtn}
      />
    </Card>
  );
}

function CommunityPreview({
  updates,
  loading,
  now,
  onOpen,
}: {
  updates: CommunityUpdate[] | null;
  loading: boolean;
  now: number;
  onOpen: () => void;
}) {
  const latest = (updates ?? [])
    .slice()
    .sort((a, b) => b.at - a.at)
    .slice(0, 2);
  return (
    <Section
      title="Community checks"
      action={<TextButton label="See all" onPress={onOpen} />}>
      <Card>
        {loading ? (
          <CardSkeleton lines={2} />
        ) : latest.length === 0 ? (
          <Text style={styles.muted}>
            No recent checks yet. Be the first to confirm what you see.
          </Text>
        ) : (
          latest.map((u, i) => (
            <View
              key={u.id}
              style={[
                styles.update,
                i < latest.length - 1 && styles.updateDiv,
              ]}>
              <View style={styles.flex}>
                <Text style={styles.updateText}>{u.text}</Text>
                <Text style={styles.updateAge}>{timeAgo(u.at, now)}</Text>
              </View>
              {u.userConfirmed && <Pill label="User-confirmed" tone="info" />}
            </View>
          ))
        )}
      </Card>
    </Section>
  );
}

/** The backup / alternative chargers near this one, with their own load states. */
function Alternatives({
  resource,
  alternatives,
  count,
  vehicle,
  now,
  onOpen,
}: {
  resource: Resource<StationWithDistance[]>;
  alternatives: StationWithDistance[];
  count: number;
  vehicle: Vehicle | null;
  now: number;
  onOpen: (id: string) => void;
}) {
  if (resource.data === null) {
    return resource.status === 'loading' ? (
      <CardSkeleton lines={3} />
    ) : (
      <Notice
        tone="warn"
        title="Couldn’t look for nearby chargers"
        body="We’ll show a backup as soon as we can reach the charger service."
        action={
          <TextButton
            label="Try again"
            icon="refresh-cw"
            onPress={resource.reload}
          />
        }
      />
    );
  }
  if (alternatives.length === 0) {
    return (
      <Text style={styles.muted}>
        We don’t know another compatible charger within 60 km of here yet.
      </Text>
    );
  }
  return (
    <>
      {alternatives.slice(0, count).map((s, i) => (
        <BackupChargerCard
          key={s.id}
          station={s}
          vehicle={vehicle}
          now={now}
          extraMin={Math.max(2, estimateDetourMin(s.distanceKm))}
          title={
            count === 1
              ? 'Backup'
              : i === 0
              ? 'Best alternative'
              : 'Another option'
          }
          onPress={() => onOpen(s.id)}
        />
      ))}
    </>
  );
}

type LoadedProps = {
  station: StationWithDistance;
  fromCache: boolean;
  status: 'loading' | 'ready' | 'error' | 'offline';
  refreshing: boolean;
  reload: () => void;
};

function StationDetailLoaded({
  station,
  fromCache,
  status,
  refreshing,
  reload,
}: LoadedProps) {
  const nav = useNavigation();
  const now = useNow();
  const {station: stationService} = useServices();
  const vehicle = useApp(selectActiveVehicle);
  const favourite = useApp(s => s.favouriteStationIds.includes(station.id));
  const battery = useApp(s => s.battery);
  const integrationDown = useDemo(s => s.integrationDown);
  const [joining, setJoining] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const usable = compatibleConnectors(station, vehicle);
  const unusable = station.connectors.filter(c => !usable.includes(c));
  const free = availableCount(station, vehicle);
  const health = stationHealth(station, vehicle);
  const unconfirmed = hasUnconfirmedConnectors(station);
  const noCompatible = vehicle !== null && usable.length === 0 && !unconfirmed;
  const busy = usable.length > 0 && free === 0 && health === 'busy';
  const offline = usable.length > 0 && health === 'offline';

  const selected =
    usable.find(c => c.id === selectedId) ??
    usable.find(c => c.status === 'available') ??
    usable[0] ??
    null;

  const needsWait = busy;
  const waitRes = useResource(
    () => stationService.waitEstimate(station.id, vehicle),
    [station.id, vehicle?.id ?? null],
    {enabled: needsWait},
  );
  const communityRes = useResource(
    () => stationService.community(station.id),
    [station.id],
  );
  // Chargers near this one that the car can use: the backup, and the pool for
  // "compare".
  const nearbyRes = useResource(async () => {
    const around = {latitude: station.latitude, longitude: station.longitude};
    const found = await stationService.nearby({origin: around, vehicle});
    // Nothing real near this charger: don't offer demo chargers far away.
    if (isDemoFallback(around, found)) {
      return [];
    }
    return found
      .filter(s => s.id !== station.id && s.distanceKm <= BACKUP_MAX_KM)
      .slice(0, NEAREST_COUNT)
      .map(s => ({...s, detourMin: estimateDetourMin(s.distanceKm)}));
  }, [station.id, vehicle?.id ?? null]);

  const alternatives = useMemo(() => {
    const list = nearbyRes.data ?? [];
    return [...list]
      .filter(s => stationHealth(s, vehicle) !== 'offline')
      .sort((a, b) => {
        const freeDiff =
          Number(availableCount(b, vehicle) > 0) -
          Number(availableCount(a, vehicle) > 0);
        return freeDiff || organicScore(b, vehicle) - organicScore(a, vehicle);
      });
  }, [nearbyRes.data, vehicle]);

  // Only claim "we recommend it" when the data gives real reasons.
  const hasReasons = whyRecommended(station, vehicle, now).reasons.length >= 2;
  const unusableHere = noCompatible || offline;
  const backup = alternatives[0] ?? null;
  const showMoreAlternatives = busy || unusableHere;

  const toggleFavourite = () => {
    const saved = toggleFavouriteStation(station.id);
    showToast(saved ? 'Saved to your list' : 'Removed from saved', 'success');
  };

  const joinQueue = async () => {
    if (joining) {
      return;
    }
    setJoining(true);
    try {
      await stationService.joinQueue(station.id);
      nav.navigate('Queue', {stationId: station.id});
    } catch (e) {
      showToast(errorMessage(e), 'danger');
    } finally {
      setJoining(false);
    }
  };

  const compare = () => {
    const others = (nearbyRes.data ?? []).slice(0, 2).map(s => s.id);
    if (others.length === 0) {
      showToast('No other chargers nearby to compare with yet.', 'warn');
      return;
    }
    nav.navigate('Compare', {stationIds: [station.id, ...others]});
  };

  const navigateTarget = unusableHere && backup ? backup : station;

  return (
    <Screen
      title="Station details"
      refreshing={refreshing}
      onRefresh={reload}
      footer={
        <PrimaryButton
          label={
            navigateTarget.id === station.id ? 'Navigate' : 'Navigate to backup'
          }
          icon="navigation"
          onPress={() =>
            nav.navigate('Navigation', {stationId: navigateTarget.id})
          }
        />
      }>
      <View style={styles.stack}>
        {status === 'error' && (
          <Notice
            tone="danger"
            title="Couldn’t refresh"
            body="Showing the last details we have."
            action={<TextButton label="Try again" onPress={reload} />}
          />
        )}
        {fromCache && (
          <Notice
            tone="warn"
            icon="wifi-off"
            title="You’re offline"
            body={`Showing details saved earlier. Status was updated ${timeAgo(
              station.statusFeed.updatedAt,
              now,
            )}.`}
            action={
              <TextButton label="Retry" icon="refresh-cw" onPress={reload} />
            }
          />
        )}

        <StationHero
          station={station}
          vehicle={vehicle}
          now={now}
          favourite={favourite}
          onToggleFavourite={toggleFavourite}
        />

        {unconfirmed && (
          <Notice
            tone="warn"
            icon="triangle-alert"
            title="Connector type unconfirmed"
            body={`Google Maps doesn’t say which plugs this charger has, so we can’t tell whether it fits ${
              vehicle ? `your ${vehicleName(vehicle)}` : 'your car'
            }. Check the plug on site before you rely on it.`}
          />
        )}
        {noCompatible && vehicle && (
          <Notice
            tone="danger"
            title={`Can’t charge your ${vehicleName(vehicle)} here`}
            body="None of this charger’s connectors fit your car. Try a compatible charger instead."
          />
        )}
        {offline && (
          <Notice
            tone="danger"
            title="This charger is offline"
            body="Every compatible connector is out of service right now. A nearby alternative is below."
          />
        )}
        {integrationDown && station.integration === 'integrated' && (
          <Notice
            tone="warn"
            icon="zap-off"
            title="Remote start is unavailable right now"
            body="You can still charge here using the charger’s own screen or QR code."
          />
        )}
        {!vehicle && (
          <Notice
            tone="info"
            icon="car"
            title="Add your EV to see what fits"
            body="Until then every connector is shown as usable."
            action={
              <TextButton
                label="Add your vehicle"
                onPress={() => nav.navigate('VehicleSetup')}
              />
            }
          />
        )}

        {busy && (
          <WaitCard
            wait={waitRes.data}
            loading={waitRes.data === null && waitRes.status === 'loading'}
            joining={joining}
            disabled={status === 'offline'}
            onJoin={joinQueue}
          />
        )}

        {showMoreAlternatives && (
          <Section title={busy ? 'Free bays nearby' : 'Try these instead'}>
            <Alternatives
              resource={nearbyRes}
              alternatives={alternatives}
              count={2}
              vehicle={vehicle}
              now={now}
              onOpen={id => nav.navigate('StationDetail', {stationId: id})}
            />
          </Section>
        )}

        {usable.length > 0 && selected && (
          <Section title="Compatible connectors">
            <View style={styles.chips}>
              {usable.map(c => (
                <ConnectorChip
                  key={c.id}
                  connector={c}
                  selected={c.id === selected.id}
                  onPress={() => setSelectedId(c.id)}
                />
              ))}
            </View>
            <ConnectorPanel
              station={station}
              vehicle={vehicle}
              connector={selected}
              now={now}
            />
            {unusable.length > 0 && vehicle && (
              <View style={styles.incompatible}>
                <Text style={styles.muted}>
                  Doesn’t fit your {vehicleName(vehicle)}:
                </Text>
                <View style={styles.chips}>
                  {unusable.map(c => (
                    <ConnectorChip
                      key={c.id}
                      connector={c}
                      compatible={false}
                    />
                  ))}
                </View>
              </View>
            )}
          </Section>
        )}

        {vehicle && selected && (
          <VehicleChargeCard
            estimate={estimateVehicleCharge(
              selected,
              vehicle,
              Math.min(battery?.percent ?? 20, 75),
              80,
            )}
            vehicleLabel={vehicleName(vehicle)}
          />
        )}

        {!noCompatible && (
          <ChargeConfidenceCard
            confidence={chargeConfidence(station, vehicle, now)}
          />
        )}

        {station.integration === 'external' && (
          <Section title="How to charge here">
            <OperatorInstructionsCard station={station} />
          </Section>
        )}

        {!noCompatible && (
          <Section title={hasReasons ? 'Why we recommend it' : 'What to know'}>
            <ReasonsCard station={station} vehicle={vehicle} now={now} />
          </Section>
        )}

        {!showMoreAlternatives && (
          <Section title="Backup if it’s busy">
            <Alternatives
              resource={nearbyRes}
              alternatives={alternatives}
              count={1}
              vehicle={vehicle}
              now={now}
              onOpen={id => nav.navigate('StationDetail', {stationId: id})}
            />
          </Section>
        )}

        {station.amenities.length > 0 && (
          <Section title="Amenities">
            <AmenityPills amenities={station.amenities} />
          </Section>
        )}

        <CommunityPreview
          updates={communityRes.data}
          loading={
            communityRes.data === null && communityRes.status === 'loading'
          }
          now={now}
          onOpen={() => nav.navigate('Community', {stationId: station.id})}
        />

        <Section title="More">
          <ListCard>
            <ListRow
              icon="trending-up"
              iconTone="lime"
              title="Expected availability"
              subtitle="How busy it usually is over the next hour"
              onPress={() => nav.navigate('Forecast', {stationId: station.id})}
            />
            {station.integration === 'integrated' && (
              <ListRow
                icon="calendar-clock"
                iconTone="info"
                title="Reserve a bay"
                subtitle="Hold a connector for your arrival time"
                onPress={() =>
                  nav.navigate('Reservation', {stationId: station.id})
                }
              />
            )}
            <ListRow
              icon="scale"
              title="Compare with nearby chargers"
              subtitle="Side by side with the two closest"
              onPress={compare}
            />
            <ListRow
              icon="indian-rupee"
              title="Estimate the cost"
              subtitle="Based on this charger’s price"
              onPress={() =>
                nav.navigate('CostCalculator', {stationId: station.id})
              }
            />
            <ListRow
              icon="flag"
              iconTone="danger"
              title="Report a problem"
              subtitle="Wrong price, broken connector, blocked bay"
              onPress={() =>
                nav.navigate('ReportProblem', {stationId: station.id})
              }
              last
            />
          </ListCard>
        </Section>
      </View>
    </Screen>
  );
}

/** 06 Station detail. */
export default function StationDetailScreen(): React.JSX.Element {
  const nav = useNavigation();
  const {params} = useRoute<'StationDetail'>();
  const {station: stationService} = useServices();
  const resource = useResource<Loaded>(async () => {
    const r = await loadStationsById(stationService, [params.stationId]);
    return {station: r.stations[0] ?? null, fromCache: r.fromCache};
  }, [params.stationId, stationService]);

  if (resource.data?.station) {
    return (
      <StationDetailLoaded
        station={resource.data.station}
        fromCache={resource.data.fromCache}
        status={resource.status}
        refreshing={resource.refreshing}
        reload={resource.reload}
      />
    );
  }
  if (resource.data) {
    // Not an outage: this id just isn't among the chargers we can see now.
    // Chargers from Google Maps only load while they're near you.
    return (
      <Screen title="Station details">
        <EmptyState
          icon="plug-zap"
          title="This charger isn’t available right now"
          body="It may have been removed, or it’s a Google Maps charger that isn’t near you at the moment. Find it again in Nearby chargers."
          primary={{
            label: 'Find chargers',
            icon: 'search',
            onPress: () => nav.navigate('StationList'),
          }}
          secondary={{label: 'Try again', onPress: resource.reload}}
        />
      </Screen>
    );
  }
  return (
    <Screen title="Station details">
      <AsyncView
        resource={resource}
        loading={
          <View style={styles.stack}>
            <CardSkeleton lines={4} />
            <CardSkeleton lines={3} />
            <CardSkeleton lines={3} />
          </View>
        }
        errorTitle="Couldn’t load this charger"
        errorBody="We couldn’t reach the charger service. Check your connection and try again."
        render={() => null}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  stack: {gap: spacing.md},
  section: {},
  sectionBody: {gap: spacing.md},
  chips: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
  incompatible: {gap: spacing.sm},
  muted: {...type.body, color: colors.muted, lineHeight: 20},
  waitHead: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  waitIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: colors.amberSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waitTitle: {...type.heading, color: colors.ink, flex: 1},
  waitLabel: {
    ...type.micro,
    color: colors.muted,
    textTransform: 'uppercase',
    marginTop: spacing.lg,
  },
  waitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  waitValue: {...type.display, color: colors.ink},
  waitBasis: {...type.caption, color: colors.muted, marginTop: spacing.xs},
  waitSkeleton: {gap: spacing.sm, marginTop: spacing.sm},
  joinBtn: {marginTop: spacing.lg, borderRadius: radii.md},
  update: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  updateDiv: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  updateText: {...type.bodyStrong, color: colors.ink},
  updateAge: {...type.caption, color: colors.muted, marginTop: 2},
});
