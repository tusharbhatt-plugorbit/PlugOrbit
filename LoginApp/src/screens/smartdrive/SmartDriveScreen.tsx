import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {describeError} from '../../domain/describeError';
import {PHRASES, kmLabel, pctLabel} from '../../intelligence/copy';
import {tripStatus} from '../../intelligence/status';
import type {ActiveTrip, TripUpdate} from '../../intelligence/types';
import {
  useIsActiveRef,
  useNavigation,
  useRoute,
} from '../../navigation/NavigationContext';
import {useServices} from '../../services';
import {openDirections} from '../../services/directions';
import {selectActiveVehicle, selectTrip, useApp} from '../../store/appStore';
import {colors, spacing, type} from '../../theme';
import {formatClock} from '../../utils/format';
import {
  Card,
  ChangeBanner,
  CopilotLog,
  CopilotStatusCard,
  EmptyState,
  JourneyBar,
  KeyValue,
  MonitoringFooter,
  Notice,
  PrimaryButton,
  RiskPill,
  Screen,
  SecondaryButton,
  SectionTitle,
  StopSummaryCard,
  TextButton,
  VehicleSelector,
  showToast,
  useTripNow,
} from '../../ui';
import {PlaceField} from '../../ui/PlaceField';

/**
 * Smart Drive. Before a trip it asks one question, "Where are we going?". During
 * one it is the dashboard of a co-pilot that is already handling the charging:
 * a calm status, the one stop that matters, and proof that it is watching.
 */
export default function SmartDriveScreen(): React.JSX.Element {
  const trip = useApp(selectTrip);
  return trip ? <TripDashboard trip={trip} /> : <TripPlanner />;
}

/* ----------------------------------------------------------------- planner -- */

function TripPlanner(): React.JSX.Element {
  const nav = useNavigation();
  const active = useIsActiveRef();
  const {smartDrive} = useServices();
  const vehicle = useApp(selectActiveVehicle);
  const battery = useApp(s => s.battery);
  const reserve = useApp(s => s.tripPrefs.minArrivalSocPct);
  const {params} = useRoute<'SmartDrive'>();
  const [from, setFrom] = useState('Delhi');
  // Home's "Where are we going?" hands its destination over here.
  const [to, setTo] = useState(params?.toLabel ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{title: string; body: string} | null>(
    null,
  );

  if (!vehicle) {
    return (
      <Screen title="Smart Drive">
        <EmptyState
          icon="car"
          title="Add your car first"
          body="Smart Drive plans every charge around your battery size and the connectors your car can use."
          primary={{
            label: 'Add your EV',
            icon: 'plus',
            onPress: () => nav.navigate('VehicleSetup'),
          }}
        />
      </Screen>
    );
  }

  const soc = battery?.percent ?? null;
  const same =
    from.trim() !== '' && from.trim().toLowerCase() === to.trim().toLowerCase();
  const ready = from.trim() !== '' && to.trim() !== '' && soc !== null && !same;

  const start = async () => {
    if (!ready) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await smartDrive.start({fromLabel: from.trim(), toLabel: to.trim()});
    } catch (e) {
      if (active.current) {
        const copy = describeError(e, 'We couldn’t plan this trip.');
        setError({title: copy.title, body: copy.body});
      }
    }
    if (active.current) {
      setBusy(false);
    }
  };

  return (
    <Screen
      title="Smart Drive"
      stack
      footer={
        <PrimaryButton
          label="Start Smart Drive"
          icon="sparkles"
          loading={busy}
          disabled={!ready}
          onPress={start}
        />
      }>
      <Text style={styles.lead}>Where are we going?</Text>
      <Card tone="dark">
        <Text style={styles.kicker}>Smart Drive</Text>
        <Text style={styles.heroTitle}>{PHRASES.tagline}</Text>
        <Text style={styles.heroBody}>
          Tell us where you’re headed. We work out if and where you need to
          charge, pick a stop and a backup, and watch the road so you don’t have
          to.
        </Text>
      </Card>

      <Card>
        <View style={styles.fields}>
          <PlaceField
            label="From"
            value={from}
            onChangeText={setFrom}
            placeholder="Start city"
            icon="navigation"
          />
          <PlaceField
            label="To"
            value={to}
            onChangeText={setTo}
            placeholder="Destination city"
            icon="flag"
            error={
              same ? 'Start and destination are the same place.' : undefined
            }
          />
        </View>
      </Card>

      <Card>
        <KeyValue
          label="Battery now"
          value={soc === null ? 'Not set' : `${soc}%`}
          emphasis
        />
        <KeyValue label="Safety reserve" value={`${reserve}%`} last />
        <View style={styles.row}>
          <VehicleSelector tone="light" />
        </View>
        <View style={styles.links}>
          <TextButton
            label={soc === null ? 'Set battery' : 'Change battery'}
            icon="battery-charging"
            onPress={() => nav.navigate('ManualSoc')}
          />
          <TextButton
            label="Preferences"
            tone="muted"
            onPress={() => nav.navigate('TripPreferences')}
          />
        </View>
      </Card>

      {soc === null && (
        <Notice
          tone="warn"
          title="Set your battery first"
          body="We need your current level to know where you’ll need to charge."
        />
      )}
      {error && <Notice tone="danger" title={error.title} body={error.body} />}
    </Screen>
  );
}

/* --------------------------------------------------------------- dashboard -- */

function TripDashboard({trip}: {trip: ActiveTrip}): React.JSX.Element {
  const nav = useNavigation();
  const active = useIsActiveRef();
  const {smartDrive} = useServices();
  const vehicle = useApp(selectActiveVehicle);
  const now = useTripNow(trip.clockOffsetMs, 15_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{title: string; body: string} | null>(
    null,
  );

  const {plan} = trip;
  const stop = plan.primary;
  const status = tripStatus(trip);
  const ended = trip.phase === 'arrived';

  /** Run an action, keep the screen honest if it fails, and say when nothing needed saying. */
  const act = async (
    key: string,
    fn: () => Promise<TripUpdate | null | void>,
    quietNote?: string,
  ) => {
    setBusy(key);
    setError(null);
    try {
      const result = await fn();
      if (
        quietNote &&
        result &&
        'notifications' in result &&
        result.notifications.length === 0 &&
        active.current
      ) {
        showToast(quietNote, 'info');
      }
    } catch (e) {
      if (active.current) {
        const copy = describeError(e, 'Something didn’t go through.');
        setError({title: copy.title, body: copy.body});
      }
    }
    if (active.current) {
      setBusy(null);
    }
  };

  const openMaps = async (target: {
    id: string;
    latitude: number;
    longitude: number;
  }) => {
    if (!(await openDirections(target))) {
      showToast('Couldn’t open Google Maps. Is it installed?', 'warn');
    }
  };

  const destination = trip.polyline[trip.polyline.length - 1];
  const primaryAction = (() => {
    if (ended) {
      return {
        label: 'Finish trip',
        icon: 'flag' as const,
        onPress: () =>
          act('finish', async () => {
            await smartDrive.end();
            showToast(
              'Trip saved. Thanks for driving with PlugOrbit.',
              'success',
            );
            nav.reset('Home');
          }),
      };
    }
    switch (trip.phase) {
      case 'ready':
        // Low on battery, the first move is the charger, not the destination.
        return stop && plan.mode === 'battery_critical'
          ? {
              label: `Navigate to ${stop.station.name
                .split('•')
                .pop()
                ?.trim()}`,
              icon: 'navigation' as const,
              onPress: () =>
                act('begin', async () => {
                  await smartDrive.begin();
                  await openMaps(stop.station);
                }),
            }
          : {
              label: 'Start driving',
              icon: 'navigation' as const,
              onPress: () =>
                act('begin', async () => {
                  await smartDrive.begin();
                  await openMaps({id: 'dest', ...destination});
                }),
            };
      case 'at_stop':
        return stop
          ? {
              label: 'Start charging',
              icon: 'plug-zap' as const,
              onPress: () =>
                nav.navigate('StartCharging', {
                  stationId: stop.station.id,
                  connectorId: stop.metrics.connectorId,
                  targetSoc: stop.metrics.targetSoc,
                }),
            }
          : null;
      case 'charging':
        return {
          label: 'View charging',
          icon: 'battery-charging' as const,
          onPress: () => nav.navigate('ActiveSession'),
        };
      default:
        return stop
          ? {
              label: `Navigate to ${stop.station.name
                .split('•')
                .pop()
                ?.trim()}`,
              icon: 'navigation' as const,
              onPress: () => openMaps(stop.station),
            }
          : {
              label: 'Open navigation',
              icon: 'navigation' as const,
              onPress: () => openMaps({id: 'dest', ...destination}),
            };
    }
  })();

  const withoutCharge = plan.destination.socWithoutCharging;
  const atArrival =
    withoutCharge.low < 1
      ? 'Can’t finish'
      : `~${pctLabel(withoutCharge.expected)}`;

  return (
    <Screen
      title="Smart Drive"
      stack
      footer={
        <>
          {!ended && trip.monitoringState !== 'ended' && (
            <MonitoringFooter
              text={
                trip.network === 'offline'
                  ? 'Offline. Your plan is saved on this phone.'
                  : stop
                  ? PHRASES.monitoringStop
                  : PHRASES.monitoringTrip
              }
            />
          )}
          {primaryAction && (
            <PrimaryButton
              label={primaryAction.label}
              icon={primaryAction.icon}
              loading={busy === 'begin' || busy === 'finish'}
              onPress={primaryAction.onPress}
            />
          )}
        </>
      }>
      <CopilotStatusCard status={status} />

      {trip.network === 'offline' && (
        <Notice
          tone="warn"
          icon="wifi-off"
          title="You’re offline."
          body="Your charging plan is still available. Statuses below are the last we saw and aren’t live."
          action={
            <TextButton
              label="See offline plan"
              onPress={() => nav.navigate('OfflineMode')}
            />
          }
        />
      )}

      <Card>
        <Text style={styles.route}>
          {trip.origin.label} → {trip.destination.label}
        </Text>
        <KeyValue label="ETA" value={formatClock(trip.eta)} />
        <KeyValue label="Battery now" value={`${pctLabel(trip.currentSoC)}`} />
        <KeyValue label="Arrival without a stop" value={atArrival} />
        <KeyValue
          label="Charging needed"
          value={trip.chargingRequired ? 'Yes' : 'No'}
        />
        <KeyValue
          label="Left to go"
          value={kmLabel(trip.distanceRemainingKm)}
          last
        />
        <JourneyBar trip={trip} />
      </Card>

      <ChangeBanner
        trip={trip}
        onKeep={() => act('keep', () => smartDrive.keepOriginal())}
      />

      {stop ? (
        <>
          <SectionTitle
            title={
              trip.phase === 'at_stop' || trip.phase === 'charging'
                ? 'Your stop'
                : 'Your next stop'
            }
            action={<RiskPill risk={plan.routeRisk} />}
          />
          <StopSummaryCard
            stop={stop}
            backup={plan.backup}
            vehicle={vehicle}
            now={now}
            onPress={() => nav.navigate('SmartDriveStop')}
          />
          <SecondaryButton
            label="Why this charger?"
            icon="sparkles"
            compact
            onPress={() => nav.navigate('SmartDriveStop')}
          />
        </>
      ) : plan.chargingRequired ? (
        <Notice
          tone="danger"
          title="Reliable charging options are limited here."
          body="We’re still looking for a charger you can safely reach, and will tell you the moment there’s one."
        />
      ) : (
        <Notice
          tone="lime"
          title="No charging stop needed"
          body={`You’ll arrive with about ${pctLabel(
            plan.destination.socWithoutCharging.expected,
          )}. ${PHRASES.noActionNeeded}`}
        />
      )}

      {error && <Notice tone="danger" title={error.title} body={error.body} />}

      <CopilotLog trip={trip} />

      {trip.simulated && !ended && (
        <DemoDrive
          trip={trip}
          busy={busy}
          onRun={act}
          signalLost={trip.network === 'offline'}
        />
      )}

      <View style={styles.center}>
        <TextButton
          label={ended ? 'Close' : 'End trip'}
          tone="muted"
          onPress={() =>
            act('end', async () => {
              await smartDrive.end();
              nav.reset('Home');
            })
          }
        />
      </View>
    </Screen>
  );
}

/** Stand-in for the phone's GPS and for real-world events, for showing it off. */
function DemoDrive({
  trip,
  busy,
  signalLost,
  onRun,
}: {
  trip: ActiveTrip;
  busy: string | null;
  signalLost: boolean;
  onRun: (
    key: string,
    fn: () => Promise<TripUpdate | null | void>,
    quietNote?: string,
  ) => Promise<void>;
}) {
  const {smartDrive} = useServices();
  const canDrive = trip.phase !== 'ready' && trip.phase !== 'charging';
  const quiet = 'Checked. Nothing you need to do.';
  return (
    <Card>
      <Text style={styles.demoTitle}>Demo drive (simulated)</Text>
      <Text style={styles.demoBody}>
        Moves the car along the route and plays out the situations PlugOrbit
        watches for. On a real drive your phone’s location does this.
      </Text>
      <View style={styles.demoRow}>
        <SecondaryButton
          label="Go to the stop"
          style={styles.half}
          icon="navigation"
          compact
          disabled={!canDrive || !trip.plan.primary}
          loading={busy === 'stop'}
          onPress={() =>
            onRun('stop', () => smartDrive.demo.driveToStop(), quiet)
          }
        />
        <SecondaryButton
          label="Drive 25 km"
          style={styles.half}
          icon="route"
          compact
          disabled={!canDrive}
          loading={busy === 'km'}
          onPress={() => onRun('km', () => smartDrive.advance(25), quiet)}
        />
      </View>
      <View style={styles.demoRow}>
        <SecondaryButton
          label="Busy charger"
          style={styles.half}
          icon="users"
          compact
          disabled={!trip.plan.primary}
          loading={busy === 'busy'}
          onPress={() => onRun('busy', () => smartDrive.demo.occupy(), quiet)}
        />
        <SecondaryButton
          label="Dead charger"
          style={styles.half}
          icon="zap-off"
          compact
          disabled={!trip.plan.primary}
          loading={busy === 'dead'}
          onPress={() =>
            onRun('dead', () => smartDrive.demo.takeOffline(), quiet)
          }
        />
      </View>
      <SecondaryButton
        label={signalLost ? 'Restore signal' : 'Lose signal'}
        icon={signalLost ? 'wifi' : 'wifi-off'}
        compact
        loading={busy === 'signal'}
        onPress={() =>
          onRun('signal', () => smartDrive.demo.setSignal(signalLost))
        }
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  lead: {...type.display, color: colors.ink},
  kicker: {...type.micro, color: colors.lime, textTransform: 'uppercase'},
  heroTitle: {...type.h1, color: '#FFFFFF', marginTop: 6},
  heroBody: {
    ...type.body,
    color: colors.chipText,
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  fields: {gap: spacing.sm},
  row: {marginTop: spacing.md},
  links: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  route: {...type.h1, color: colors.ink, marginBottom: spacing.sm},
  center: {alignItems: 'center'},
  demoTitle: {...type.heading, color: colors.ink},
  demoBody: {
    ...type.caption,
    color: colors.muted,
    marginTop: 4,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  demoRow: {flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm},
  half: {flex: 1},
});
