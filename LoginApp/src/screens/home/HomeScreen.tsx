import React, {useMemo, useState} from 'react';
import {
  Pressable,
  RefreshControl,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {resumeSession} from '../../app/initialStack';
import {billFor} from '../../domain/sessionBill';
import {applyFilters, rankOrganic} from '../../domain/rules';
import {describeSocSource} from '../../domain/socEstimate';
import {timeAgo} from '../../domain/trust';
import {useNearbyStations} from '../../hooks/useNearbyStations';
import {DEFAULT_SMART_DRIVE_CONFIG} from '../../intelligence/config';
import {idleStatus, tripStatus} from '../../intelligence/status';
import {useNavigation} from '../../navigation/NavigationContext';
import type {RouteName} from '../../navigation/params';
import {selectActiveVehicle, selectTrip, useApp} from '../../store/appStore';
import {colors, elevation, radii, sizes, spacing, type} from '../../theme';
import {
  Card,
  CardSkeleton,
  ChargerCard,
  Icon,
  IconName,
  Notice,
  Pill,
  PrimaryButton,
  SecondaryButton,
  SectionTitle,
  TextButton,
  TextField,
  useNow,
  vehicleName,
} from '../../ui';
import {BrandLogo} from '../../ui/BrandLogo';
import {BatteryBar} from '../../ui/battery';
import {KeyboardAvoider, KeyboardAwareScrollView} from '../../ui/KeyboardAware';

/**
 * Home: the driver's control centre. Where the car stands, where to next, what
 * Orbit Assist is doing, and one tap to every part of the app. The map lives one
 * tap away (Find chargers).
 *
 * Nothing here is invented: the battery is the stored reading with its real
 * source and age, the range is the estimate the rest of the app uses, and the
 * nearby charger comes from the same service as the map.
 */
export default function HomeScreen(): React.JSX.Element {
  const nav = useNavigation();
  const now = useNow(30_000);
  const vehicle = useApp(selectActiveVehicle);
  const battery = useApp(s => s.battery);
  const link = useApp(s => s.vehicleLink);
  const session = useApp(s => s.session);
  const filters = useApp(s => s.filters);
  const unread = useApp(s => s.notifications.some(n => !n.read));
  const reserve = useApp(s => s.tripPrefs.minArrivalSocPct);
  const assistOn = useApp(s => s.smartDrive.prefs.enabled);
  const outcomes = useApp(s => s.smartDrive.outcomes);
  const savedRoutes = useApp(s => s.savedRoutes);
  const trip = useApp(selectTrip);
  const nearby = useNearbyStations(vehicle);
  const [destination, setDestination] = useState('');
  // Two half-width buttons: drop their icons on the narrowest phones so labels fit on one line.
  const narrow = useWindowDimensions().width < 360;

  const soc = battery?.percent ?? null;
  const critical = DEFAULT_SMART_DRIVE_CONFIG.batteryCriticalPct;

  const status = trip
    ? tripStatus(trip)
    : idleStatus({soc, vehicle, reservePct: reserve, criticalPct: critical});
  const low = !trip && status.tone === 'alert';
  const needsSetup = !vehicle || soc === null;

  const nearest = useMemo(
    () =>
      rankOrganic(
        applyFilters(nearby.stations, filters, vehicle),
        vehicle,
      )[0] ?? null,
    [nearby.stations, filters, vehicle],
  );
  const recentTrip = useMemo(
    () =>
      outcomes.length
        ? outcomes.reduce((a, b) => (b.endedAt > a.endedAt ? b : a))
        : null,
    [outcomes],
  );

  const go = (name: RouteName, params?: unknown) =>
    (nav.navigate as (n: RouteName, p?: unknown) => void)(name, params);

  const planJourney = () => {
    const toLabel = destination.trim();
    go('SmartDrive', toLabel ? {toLabel} : undefined);
  };

  // Orbit Assist: one status, and the one thing to do about it.
  const assist = trip
    ? {pill: 'Active', tone: 'lime' as const, cta: 'Open trip'}
    : !assistOn
    ? {pill: 'Off', tone: 'slate' as const, cta: 'Turn on'}
    : needsSetup
    ? {pill: 'Setup needed', tone: 'amber' as const, cta: 'Set up'}
    : low
    ? {pill: 'Battery low', tone: 'danger' as const, cta: 'Find chargers'}
    : {pill: 'Ready', tone: 'slate' as const, cta: 'Plan a journey'};
  const openAssist = () => {
    if (!vehicle) {
      go('VehicleSetup');
    } else if (!trip && soc === null) {
      go('ManualSoc');
    } else if (!trip && !assistOn) {
      go('TripPreferences');
    } else if (low) {
      // Running low and nowhere in particular to be: the nearest chargers.
      go('StationList');
    } else {
      go('SmartDrive');
    }
  };

  const where = locationLabel(nearby);
  const sourceView = describeSocSource(link, battery, now);
  const rangeKm =
    vehicle && soc !== null
      ? Math.round((vehicle.rangeKm100 * soc) / 100 / 5) * 5
      : null;
  const charging = session?.status === 'active' ? session : null;
  const chargingPct = charging
    ? Math.round(billFor(charging, now).metrics.socPercent)
    : null;
  const refreshing = nearby.phase === 'locating' || nearby.phase === 'loading';

  return (
    <KeyboardAvoider>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <StatusBar barStyle="light-content" />

        <View style={styles.header}>
          <BrandLogo size={38} />
          <View style={styles.headerText}>
            <Text style={styles.wordmark} accessibilityRole="header">
              PlugOrbit
            </Text>
            <Pressable
              onPress={() => go('Map')}
              hitSlop={{top: 12, bottom: 12, left: 4, right: 12}}
              accessibilityRole="button"
              accessibilityLabel={`Location: ${where.text}. Open the charger map`}
              testID="location-indicator"
              style={styles.where}>
              <View style={[styles.whereDot, where.ok && styles.whereDotOn]} />
              <Text style={styles.whereText} numberOfLines={1}>
                {where.text}
              </Text>
            </Pressable>
          </View>
          <Pressable
            onPress={() => go('Notifications')}
            accessibilityRole="button"
            accessibilityLabel={
              unread ? 'Notifications, unread' : 'Notifications'
            }
            testID="open-notifications"
            style={styles.headerBtn}>
            <Icon name="bell" size={22} color="#FFFFFF" />
            {unread && <View style={styles.unread} />}
          </Pressable>
          <Pressable
            onPress={() => go('Profile')}
            accessibilityRole="button"
            accessibilityLabel="Profile"
            testID="open-profile"
            style={styles.headerBtn}>
            <View style={styles.avatar}>
              <Icon name="user" size={18} color={colors.ink} />
            </View>
          </Pressable>
        </View>

        <View style={styles.sheet}>
          <KeyboardAwareScrollView
            style={styles.flex}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={nearby.refresh}
                tintColor={colors.limeDark}
              />
            }>
            <View style={styles.column}>
              {low && (
                <Notice
                  tone="danger"
                  title={status.headline}
                  body={status.detail}
                  action={
                    <TextButton
                      label="Find chargers"
                      tone="danger"
                      icon="map-pin"
                      onPress={() => go('StationList')}
                    />
                  }
                />
              )}

              {/* ---- The car ---- */}
              <Card tone="dark" testID="vehicle-overview">
                {!vehicle ? (
                  <View style={styles.gap}>
                    <Text style={styles.darkTitle}>Add your EV</Text>
                    <Text style={styles.darkBody}>
                      So we only show chargers that fit your car and plan every
                      charge around its battery.
                    </Text>
                    <PrimaryButton
                      label="Add your EV"
                      icon="plus"
                      variant="lime"
                      onPress={() => go('VehicleSetup')}
                    />
                  </View>
                ) : (
                  <View style={styles.gap}>
                    <View style={styles.carRow}>
                      <View style={styles.carIcon}>
                        <Icon name="car" size={22} color={colors.lime} />
                      </View>
                      <View style={styles.flex}>
                        <Text style={styles.darkTitle} numberOfLines={1}>
                          {vehicleName(vehicle)}
                        </Text>
                        <Text style={styles.darkMeta} numberOfLines={1}>
                          {link.connected
                            ? 'Car connected'
                            : 'Car not connected'}
                        </Text>
                      </View>
                      {charging ? (
                        <Pill label="Charging" tone="lime" dot />
                      ) : null}
                    </View>

                    {soc === null ? (
                      <View style={styles.gap}>
                        <Text style={styles.darkBody}>
                          Your battery level isn’t set yet. Set it and Orbit
                          Assist can plan around it.
                        </Text>
                        <PrimaryButton
                          label="Set battery level"
                          icon="battery-charging"
                          variant="lime"
                          onPress={() => go('ManualSoc')}
                        />
                      </View>
                    ) : (
                      <>
                        <View style={styles.socRow}>
                          <Text
                            style={styles.soc}
                            maxFontSizeMultiplier={1.2}
                            accessibilityLabel={`Battery ${soc} percent`}>
                            {soc}
                            <Text style={styles.socUnit}>%</Text>
                          </Text>
                          <View style={styles.socSide}>
                            <Text
                              style={styles.range}
                              maxFontSizeMultiplier={1.2}>
                              {rangeKm !== null ? `~${rangeKm} km` : ''}
                            </Text>
                            <Text style={styles.rangeLabel}>est. range</Text>
                          </View>
                        </View>
                        <BatteryBar percent={soc} reservePct={reserve} />
                        {sourceView && (
                          <View style={styles.sourceRow}>
                            <Pill
                              label={sourceView.label}
                              tone={sourceView.tone}
                            />
                            <Text style={styles.darkMeta} numberOfLines={2}>
                              {battery
                                ? `Updated ${timeAgo(battery.updatedAt, now)}`
                                : ''}
                            </Text>
                          </View>
                        )}
                        {charging && chargingPct !== null && (
                          <Pressable
                            onPress={() => resumeSession(nav)}
                            accessibilityRole="button"
                            accessibilityLabel={`Charging at ${charging.stationName}, ${chargingPct} percent. Open session`}
                            style={({pressed}) => [
                              styles.chargingRow,
                              pressed && styles.pressed,
                            ]}>
                            <Icon
                              name="zap"
                              size={16}
                              color={colors.ink}
                              filled
                            />
                            <Text style={styles.chargingText} numberOfLines={1}>
                              {`Charging at ${charging.stationName} • ${chargingPct}%`}
                            </Text>
                            <Icon
                              name="chevron-right"
                              size={16}
                              color={colors.ink}
                            />
                          </Pressable>
                        )}
                        <View style={styles.cardActions}>
                          <SecondaryButton
                            label="Set battery"
                            icon={narrow ? undefined : 'pencil'}
                            compact
                            onPress={() => go('ManualSoc')}
                            style={styles.cardAction}
                          />
                          <SecondaryButton
                            label="Connect car"
                            icon={narrow ? undefined : 'link'}
                            compact
                            onPress={() => go('AutoSoc')}
                            style={styles.cardAction}
                          />
                        </View>
                      </>
                    )}
                  </View>
                )}
              </Card>

              {/* ---- Where next ---- */}
              <Card>
                <View style={styles.gap}>
                  <Text style={styles.cardTitle} accessibilityRole="header">
                    Where are we going?
                  </Text>
                  <TextField
                    icon="flag"
                    value={destination}
                    onChangeText={setDestination}
                    placeholder="City or place"
                    accessibilityLabel="Destination"
                    returnKeyType="go"
                    onSubmitEditing={planJourney}
                    autoCorrect={false}
                    testID="destination-input"
                  />
                  <PrimaryButton
                    label="Plan my journey"
                    icon="route"
                    onPress={planJourney}
                  />
                </View>
              </Card>

              {/* ---- Orbit Assist ---- */}
              <Card tone="lime" testID="orbit-assist-panel">
                <View style={styles.gap}>
                  <View style={styles.assistHead}>
                    <View style={styles.assistIcon}>
                      <Icon name="sparkles" size={18} color={colors.lime} />
                    </View>
                    <Text style={styles.assistTitle}>Orbit Assist</Text>
                    <Pill label={assist.pill} tone={assist.tone} />
                  </View>
                  <View>
                    <Text style={styles.assistHeadline}>{status.headline}</Text>
                    <Text style={styles.assistDetail}>{status.detail}</Text>
                  </View>
                  <PrimaryButton
                    label={assist.cta}
                    icon={trip ? 'arrow-right' : 'sparkles'}
                    compact
                    onPress={openAssist}
                  />
                </View>
              </Card>

              {/* ---- Everything else, one tap away ---- */}
              <View style={styles.group}>
                <SectionTitle compact title="Quick actions" />
                <View style={styles.grid}>
                  <Tile
                    icon="map-pin"
                    label="Find chargers"
                    onPress={() => go('Map')}
                  />
                  <Tile
                    icon="route"
                    label="Plan trip"
                    onPress={() => go('RoutePlanner')}
                  />
                  <Tile
                    icon="car"
                    label="My vehicle"
                    onPress={() => go('Vehicles')}
                  />
                  <Tile
                    icon="history"
                    label="Charging history"
                    onPress={() => go('Activity')}
                  />
                  <Tile
                    icon="bookmark"
                    label="Saved stations"
                    onPress={() => go('Saved')}
                  />
                  <Tile
                    icon="sparkles"
                    label="Orbit Assist"
                    onPress={() => go('SmartDrive')}
                  />
                </View>
              </View>

              {/* ---- Recent trip ---- */}
              {recentTrip ? (
                <View style={styles.group}>
                  <SectionTitle compact title="Recent trip" />
                  <Card
                    onPress={() => go('SmartDrive', {toLabel: recentTrip.to})}
                    accessibilityLabel={`${recentTrip.from} to ${recentTrip.to}. Plan this trip again`}>
                    <View style={styles.tripRow}>
                      <View style={styles.flex}>
                        <Text style={styles.tripTitle} numberOfLines={1}>
                          {`${recentTrip.from} → ${recentTrip.to}`}
                        </Text>
                        <Text style={styles.tripMeta}>
                          {`${timeAgo(recentTrip.endedAt, now)} • ${
                            recentTrip.followedPlan
                              ? 'You followed the plan'
                              : 'You changed the plan'
                          }`}
                        </Text>
                      </View>
                      <Text style={styles.tripAction}>Plan again</Text>
                    </View>
                  </Card>
                </View>
              ) : savedRoutes.length > 0 ? (
                <View style={styles.group}>
                  <SectionTitle compact title="Saved route" />
                  <Card
                    onPress={() =>
                      go('RoutePlanner', {
                        fromLabel: savedRoutes[0].fromLabel,
                        toLabel: savedRoutes[0].toLabel,
                      })
                    }
                    accessibilityLabel={`${savedRoutes[0].fromLabel} to ${savedRoutes[0].toLabel}. Open the route planner`}>
                    <View style={styles.tripRow}>
                      <View style={styles.flex}>
                        <Text style={styles.tripTitle} numberOfLines={1}>
                          {`${savedRoutes[0].fromLabel} → ${savedRoutes[0].toLabel}`}
                        </Text>
                        <Text style={styles.tripMeta}>Saved by you</Text>
                      </View>
                      <Text style={styles.tripAction}>Plan</Text>
                    </View>
                  </Card>
                </View>
              ) : null}

              {/* ---- Nearby charger ---- */}
              <View style={styles.group}>
                <SectionTitle
                  compact
                  title="Nearby charger"
                  action={
                    <TextButton label="See map" onPress={() => go('Map')} />
                  }
                />
                <NearbyCharger
                  nearby={nearby}
                  nearest={nearest}
                  vehicleKnown={!!vehicle}
                  now={now}
                  onOpen={id => go('StationDetail', {stationId: id})}
                  onMap={() => go('Map')}
                />
              </View>
            </View>
          </KeyboardAwareScrollView>
        </View>
      </SafeAreaView>
    </KeyboardAvoider>
  );
}

type Nearby = ReturnType<typeof useNearbyStations>;

/** What to say about where the phone is, without pretending to know more. */
function locationLabel(n: Nearby): {text: string; ok: boolean} {
  const kind = n.notice?.kind;
  if (
    kind === 'location-denied' ||
    kind === 'location-unavailable' ||
    kind === 'location-no-fix'
  ) {
    return {text: 'Location off', ok: false};
  }
  if (kind === 'demo-area') {
    return {text: 'Demo area: New Delhi', ok: false};
  }
  if (n.phase === 'locating') {
    return {text: 'Finding you…', ok: false};
  }
  return n.userLocation
    ? {text: 'Near you', ok: true}
    : {text: 'Location unknown', ok: false};
}

function NearbyCharger({
  nearby,
  nearest,
  vehicleKnown,
  now,
  onOpen,
  onMap,
}: {
  nearby: Nearby;
  nearest: ReturnType<typeof rankOrganic>[number] | null;
  vehicleKnown: boolean;
  now: number;
  onOpen: (id: string) => void;
  onMap: () => void;
}) {
  const vehicle = useApp(selectActiveVehicle);
  const kind = nearby.notice?.kind;
  const locationOff =
    kind === 'location-denied' ||
    kind === 'location-unavailable' ||
    kind === 'location-no-fix';

  if (nearby.phase !== 'ready') {
    return <CardSkeleton lines={3} />;
  }
  if (locationOff) {
    return (
      <Notice
        tone="warn"
        title="Location is off"
        body="Turn on location to see the closest charger. You can still search the map."
        action={<TextButton label="Open the map" onPress={onMap} />}
      />
    );
  }
  if (kind === 'offline' || kind === 'search-failed') {
    return (
      <Notice
        tone="info"
        title="Couldn’t load chargers"
        body={nearby.notice?.message}
        action={<TextButton label="Try again" onPress={nearby.refresh} />}
      />
    );
  }
  if (!nearest) {
    return (
      <Notice
        tone="info"
        title={
          vehicleKnown
            ? 'No compatible chargers nearby'
            : 'No chargers found nearby'
        }
        body="Try the map to look somewhere else."
        action={<TextButton label="Open the map" onPress={onMap} />}
      />
    );
  }
  return (
    <View style={styles.gap}>
      <ChargerCard
        station={nearest}
        vehicle={vehicle}
        now={now}
        onPress={() => onOpen(nearest.id)}
      />
      {kind === 'demo-area' && (
        <Text style={styles.tripMeta}>{nearby.notice?.message}</Text>
      )}
    </View>
  );
}

function Tile({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      android_ripple={{color: 'rgba(15,23,42,0.08)'}}
      style={({pressed}) => [
        styles.tile,
        elevation(1),
        pressed && styles.pressed,
      ]}>
      <View style={styles.tileIcon}>
        <Icon name={icon} size={20} color={colors.limeDark} />
      </View>
      <Text style={styles.tileLabel} maxFontSizeMultiplier={1.3}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  safe: {flex: 1, backgroundColor: colors.bg},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  headerText: {flex: 1, minWidth: 0},
  wordmark: {...type.heading, color: '#FFFFFF', letterSpacing: 0.3},
  where: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 20,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  whereDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.amberOnDark,
  },
  whereDotOn: {backgroundColor: colors.lime},
  whereText: {...type.caption, color: colors.chipText, flexShrink: 1},
  headerBtn: {
    width: sizes.tap,
    height: sizes.tap,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unread: {
    position: 'absolute',
    top: 9,
    right: 9,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.lime,
    borderWidth: 1.5,
    borderColor: colors.bg,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: {
    flex: 1,
    backgroundColor: colors.body,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    overflow: 'hidden',
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  column: {
    width: '100%',
    maxWidth: sizes.maxContent,
    alignSelf: 'center',
    gap: spacing.lg,
  },
  gap: {gap: spacing.md},
  group: {gap: spacing.sm},
  pressed: {opacity: 0.85},

  darkTitle: {...type.title, color: '#FFFFFF'},
  darkBody: {...type.body, color: colors.chipText, lineHeight: 20},
  darkMeta: {...type.caption, color: colors.placeholder, flexShrink: 1},
  carRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  carIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colors.bgRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  socRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  soc: {...type.hero, color: '#FFFFFF'},
  socUnit: {fontSize: 26, fontWeight: '800', color: colors.chipText},
  socSide: {alignItems: 'flex-end', paddingBottom: 8},
  range: {...type.heading, fontSize: 20, color: colors.lime},
  rangeLabel: {...type.caption, color: colors.placeholder},
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  chargingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: sizes.tap,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.lime,
  },
  chargingText: {...type.bodyStrong, color: colors.ink, flex: 1},
  cardActions: {flexDirection: 'row', gap: spacing.sm},
  cardAction: {flex: 1},

  cardTitle: {...type.heading, fontSize: 18, color: colors.ink},

  assistHead: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  assistIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assistTitle: {...type.heading, color: colors.ink, flex: 1},
  assistHeadline: {...type.bodyStrong, fontSize: 16, color: colors.ink},
  assistDetail: {
    ...type.body,
    color: colors.inkSoft,
    lineHeight: 20,
    marginTop: 2,
  },

  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md},
  tile: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 92,
    minHeight: 92,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: spacing.sm,
  },
  tileIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: colors.limeSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: {...type.label, color: colors.ink, textAlign: 'center'},

  tripRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  tripTitle: {...type.heading, color: colors.ink},
  tripMeta: {...type.caption, color: colors.muted, marginTop: 2},
  tripAction: {...type.label, color: colors.limeDark},
});
