import React, {useEffect, useMemo, useState} from 'react';
import {
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {batteryStatus} from '../../domain/battery';
import {driverStatus, tripStatus} from '../../domain/tripStatus';
import {timeAgo} from '../../domain/trust';
import {describeSocSource} from '../../domain/socEstimate';
import {useNavigation} from '../../navigation/NavigationContext';
import {useServices} from '../../services';
import {selectActiveVehicle, TripRecord, useApp} from '../../store/appStore';
import {colors, elevation, radii, slopFor, spacing, type} from '../../theme';
import {formatInr} from '../../utils/format';
import {
  ActiveTripCard,
  BatteryGauge,
  Card,
  Icon,
  IconName,
  ListCard,
  ListRow,
  LogoTile,
  OfflineBanner,
  PrimaryButton,
  StatusLine,
  TextButton,
  VehicleSelector,
  useNow,
} from '../../ui';

/**
 * Home. It starts from the driver, not from the map: the car and its battery,
 * one calm line saying whether anything needs doing (usually "You're good to
 * drive."), the question "Where are we going?", and the three things a driver
 * actually wants: plan a trip, charge nearby, or get to a charger now. The map
 * of chargers is one tap away, as context rather than the point.
 */
function HomeScreen(): React.JSX.Element {
  const nav = useNavigation();
  const now = useNow(30_000);
  const {route: routeService} = useServices();
  const vehicle = useApp(selectActiveVehicle);
  const battery = useApp(s => s.battery);
  const link = useApp(s => s.vehicleLink);
  const trip = useApp(s => s.activeTrip);
  const prefs = useApp(s => s.tripPrefs);
  const smartDrive = useApp(s => s.smartDrivePrefs);
  const saved = useApp(s => s.savedRoutes);
  const past = useApp(s => s.completedTrips);
  const unread = useApp(s => s.notifications.some(n => !n.read));

  const [where, setWhere] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // Places that match what is being typed; the saved trips' destinations when
  // the box is empty, so the usual trip is one tap.
  useEffect(() => {
    let alive = true;
    routeService
      .suggestions(where)
      .then(list => alive && setSuggestions(list.slice(0, 5)))
      .catch(() => alive && setSuggestions([]));
    return () => {
      alive = false;
    };
  }, [routeService, where]);

  // The car card speaks about the car (battery), the trip card about the trip,
  // so Home never says the same sentence twice.
  const status = useMemo(
    () =>
      driverStatus({
        vehicle,
        battery,
        trip: null,
        reservePct: prefs.minArrivalSocPct,
        remindKm: smartDrive.remindKm,
      }),
    [vehicle, battery, prefs.minArrivalSocPct, smartDrive.remindKm],
  );
  const running = trip && trip.phase !== 'ended' ? trip : null;
  const tripLine = running ? tripStatus(running, smartDrive.remindKm) : null;

  // Where people usually go first: their saved and finished trips, then the
  // rest. Never the place the planner starts from.
  const ideas = useMemo(() => {
    if (running) {
      return [];
    }
    const own = where.trim()
      ? []
      : [...saved.map(r => r.toLabel), ...past.map(t => t.destination)];
    return [...new Set([...own, ...suggestions])]
      .filter(p => p.toLowerCase() !== 'delhi')
      .slice(0, 5);
  }, [running, where, saved, past, suggestions]);
  const band =
    vehicle && battery
      ? batteryStatus(vehicle, battery.percent, prefs.minArrivalSocPct)
      : null;
  const source = describeSocSource(link, battery, now);
  const urgent = band?.band === 'critical' || band?.band === 'low';

  const planTo = (toLabel?: string) =>
    nav.navigate('RoutePlanner', toLabel ? {toLabel} : undefined);

  const onStatusAction = () => {
    switch (status.action) {
      case 'add_vehicle':
        return nav.navigate('VehicleSetup');
      case 'set_battery':
        return nav.navigate('ManualSoc');
      case 'battery_critical':
        return nav.navigate('ChargePick', {mode: 'critical'});
      case 'charge_nearby':
        return nav.navigate('ChargePick', {mode: 'nearby'});
      case 'open_trip':
        return nav.navigate('SmartDrive');
      default:
        return planTo();
    }
  };
  const needsSetup =
    status.action === 'add_vehicle' || status.action === 'set_battery';

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
          PlugOrbit
        </Text>
        <View style={[styles.headerSide, styles.headerRight]}>
          <LogoTile />
        </View>
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        <View style={styles.dark}>
          {/* ---- the car and its battery ---------------------------------- */}
          <View style={styles.carCard} testID="home-vehicle-card">
            <View style={styles.carTop}>
              <VehicleSelector tone="dark" />
              {battery && source && (
                <Text style={styles.source}>
                  {source.label} • {timeAgo(battery.updatedAt, now)}
                </Text>
              )}
            </View>
            {battery && vehicle ? (
              <>
                <View style={styles.batteryRow}>
                  <Text
                    style={styles.batteryBig}
                    accessibilityLabel={`Battery ${battery.percent} percent`}
                    testID="home-battery">
                    {battery.percent}%
                  </Text>
                  <Pressable
                    onPress={() => nav.navigate('ManualSoc')}
                    hitSlop={slopFor(36)}
                    accessibilityRole="button"
                    accessibilityLabel="Update battery"
                    style={styles.updateBtn}>
                    <Icon
                      name="battery-charging"
                      size={16}
                      color={colors.lime}
                    />
                    <Text style={styles.updateText}>Update</Text>
                  </Pressable>
                </View>
                <BatteryGauge
                  percent={battery.percent}
                  reservePct={prefs.minArrivalSocPct}
                  onDark
                />
              </>
            ) : null}
            <View style={styles.statusWrap}>
              <StatusLine
                tone={status.tone}
                headline={status.headline}
                detail={status.detail}
                onDark
                testID="home-status"
              />
            </View>
            {needsSetup && (
              <PrimaryButton
                label={
                  status.action === 'add_vehicle'
                    ? 'Add your car'
                    : 'Set your battery'
                }
                icon={
                  status.action === 'add_vehicle' ? 'car' : 'battery-charging'
                }
                variant="lime"
                compact
                onPress={onStatusAction}
                style={styles.setupBtn}
              />
            )}
          </View>

          {/* ---- where to ----------------------------------------------------- */}
          <View style={[styles.searchBox, elevation(1)]}>
            <Icon name="search" size={18} color={colors.muted} />
            <TextInput
              value={where}
              onChangeText={setWhere}
              onSubmitEditing={() => planTo(where.trim() || undefined)}
              placeholder="Where are we going?"
              placeholderTextColor={colors.placeholder}
              style={styles.searchInput}
              returnKeyType="go"
              autoCorrect={false}
              clearButtonMode="while-editing"
              accessibilityLabel="Where are we going?"
              testID="home-destination"
            />
          </View>
          {ideas.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
              keyboardShouldPersistTaps="handled">
              {ideas.map(place => (
                <Pressable
                  key={place}
                  onPress={() => planTo(place)}
                  hitSlop={slopFor(36)}
                  accessibilityRole="button"
                  accessibilityLabel={`Plan a trip to ${place}`}
                  style={({pressed}) => [
                    styles.chip,
                    pressed && styles.chipPressed,
                  ]}>
                  <Text style={styles.chipText}>{place}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          {/* ---- the three intents -------------------------------------------- */}
          <View style={styles.actions}>
            <Action
              icon="route"
              label="Plan a trip"
              onPress={() => planTo(where.trim() || undefined)}
            />
            <Action
              icon="zap"
              label="Charge nearby"
              onPress={() => nav.navigate('ChargePick', {mode: 'nearby'})}
            />
            <Action
              icon="battery-warning"
              label="Battery critical"
              tone={
                band?.band === 'critical'
                  ? 'critical'
                  : urgent
                  ? 'warn'
                  : 'default'
              }
              onPress={() => nav.navigate('ChargePick', {mode: 'critical'})}
            />
          </View>
        </View>

        {/* ---- the light sheet --------------------------------------------- */}
        <View style={styles.sheet}>
          <OfflineBanner />
          <View style={styles.sheetBody}>
            {running && tripLine ? (
              <ActiveTripCard
                trip={running}
                status={tripLine}
                onOpen={() => nav.navigate('SmartDrive')}
              />
            ) : past.length > 0 ? (
              <LastTripCard
                record={past[0]}
                onAgain={() =>
                  nav.navigate('RoutePlanner', {
                    fromLabel: past[0].origin,
                    toLabel: past[0].destination,
                  })
                }
              />
            ) : (
              <HowItWorks />
            )}

            {saved.length > 0 && !running && (
              <>
                <Text style={styles.section}>Your usual trips</Text>
                <ListCard>
                  {saved.slice(0, 3).map((r, i, arr) => (
                    <ListRow
                      key={r.id}
                      icon="route"
                      title={`${r.fromLabel} → ${r.toLabel}`}
                      subtitle="Plan it again"
                      onPress={() =>
                        nav.navigate('RoutePlanner', {
                          fromLabel: r.fromLabel,
                          toLabel: r.toLabel,
                        })
                      }
                      last={i === arr.length - 1}
                    />
                  ))}
                </ListCard>
              </>
            )}

            <ListCard>
              <ListRow
                icon="map"
                title="Chargers around you"
                subtitle="See the map and everything nearby"
                onPress={() => nav.navigate('Map')}
                last
              />
            </ListCard>

            <Text style={styles.tagline}>You drive. We handle the charge.</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Action({
  icon,
  label,
  onPress,
  tone = 'default',
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  tone?: 'default' | 'warn' | 'critical';
}) {
  const accent =
    tone === 'critical'
      ? colors.dangerOnDark
      : tone === 'warn'
      ? colors.warnOnDark
      : colors.lime;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({pressed}) => [
        styles.action,
        tone !== 'default' && {borderColor: accent},
        pressed && styles.chipPressed,
      ]}>
      <Icon name={icon} size={22} color={accent} />
      <Text style={styles.actionText} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

/** The whole idea in three lines, for a driver who has never used PlugOrbit. */
function HowItWorks() {
  return (
    <Card tone="lime" testID="how-it-works">
      <Text style={styles.howTitle}>
        Drive normally. We’ll handle the charge.
      </Text>
      <View style={styles.steps}>
        {[
          'Tell us where you’re going.',
          'We pick the charger, a backup, and how much to charge.',
          'We watch it as you drive and only speak up when it matters.',
        ].map((line, i) => (
          <View key={line} style={styles.step}>
            <View style={styles.stepNum}>
              <Text style={styles.stepNumText}>{i + 1}</Text>
            </View>
            <Text style={styles.stepText}>{line}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

/** After a trip: what it was, and the one-tap way to do it again. */
function LastTripCard({
  record,
  onAgain,
}: {
  record: TripRecord;
  onAgain: () => void;
}) {
  return (
    <Card testID="last-trip">
      <Text style={styles.lastKicker}>Last trip</Text>
      <Text style={styles.lastTitle}>
        {record.origin} → {record.destination}
      </Text>
      <Text style={styles.lastMeta}>
        {record.distanceKm} km • {record.stops}{' '}
        {record.stops === 1 ? 'charging stop' : 'charging stops'}
        {record.costInr > 0 ? ` • ${formatInr(record.costInr)}` : ''}
      </Text>
      <View style={styles.lastAction}>
        <TextButton label="Plan it again" icon="route" onPress={onAgain} />
      </View>
    </Card>
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
  scroll: {flexGrow: 1},
  dark: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  carCard: {
    backgroundColor: colors.bgRaised,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.chipBorder,
  },
  carTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  source: {...type.caption, color: colors.chipText, fontSize: 11.5},
  batteryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  batteryBig: {
    fontSize: 48,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -1,
  },
  updateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    height: 36,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.chipBorder,
  },
  updateText: {...type.label, color: colors.chipText},
  statusWrap: {
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.chipBorder,
  },
  setupBtn: {marginTop: spacing.lg},
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    height: 52,
  },
  searchInput: {flex: 1, fontSize: 14, color: colors.ink, paddingVertical: 0},
  chips: {gap: 10, paddingRight: spacing.xl},
  chip: {
    paddingHorizontal: 18,
    height: 36,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipPressed: {backgroundColor: colors.bgRaised},
  chipText: {color: colors.chipText, fontSize: 14, fontWeight: '600'},
  actions: {flexDirection: 'row', gap: spacing.sm},
  action: {
    flex: 1,
    minHeight: 76,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    backgroundColor: colors.bgRaised,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
  },
  actionText: {...type.label, color: '#FFFFFF', textAlign: 'center'},
  sheet: {
    flex: 1,
    backgroundColor: colors.body,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    overflow: 'hidden',
    minHeight: 280,
  },
  sheetBody: {padding: spacing.xl, gap: spacing.md},
  section: {...type.heading, color: colors.ink, marginTop: spacing.sm},
  tagline: {
    ...type.caption,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  howTitle: {...type.heading, color: colors.ink},
  lastKicker: {
    ...type.micro,
    color: colors.limeDark,
    textTransform: 'uppercase',
  },
  lastTitle: {...type.h1, color: colors.ink, marginTop: 4},
  lastMeta: {...type.caption, color: colors.inkSoft, marginTop: 4},
  lastAction: {alignItems: 'flex-start', marginTop: spacing.sm},
  steps: {gap: spacing.md, marginTop: spacing.md},
  step: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  stepNum: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: {...type.micro, color: colors.lime},
  stepText: {...type.body, color: colors.inkSoft, flex: 1, lineHeight: 20},
});

export default HomeScreen;
