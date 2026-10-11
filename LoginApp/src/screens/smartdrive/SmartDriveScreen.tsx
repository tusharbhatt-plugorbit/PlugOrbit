import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { describeError } from '../../domain/describeError';
import { PHRASES, kmLabel, pctLabel } from '../../intelligence/copy';
import { assistModeOf } from '../../intelligence/types';
import { tripStatus } from '../../intelligence/status';
import type { ActiveTrip, TripUpdate } from '../../intelligence/types';
import {
  useIsActiveRef,
  useNavigation,
  useRoute,
} from '../../navigation/NavigationContext';
import { RUNS_ON_DEMO_DATA, useServices } from '../../services';
import { openDirections } from '../../services/directions';
import { getCurrentLocation } from '../../services/location';
import type { Coords } from '../../utils/geo';
import { selectActiveVehicle, selectTrip, useApp } from '../../store/appStore';
import { colors, spacing, type } from '../../theme';
import { formatClock } from '../../utils/format';
import {
  AssistModeSelector,
  Card,
  ChangeBanner,
  CopilotLog,
  CopilotStatusCard,
  EmptyState,
  JourneyBar,
  KeyValue,
  IconButton,
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
import { PlaceField } from '../../ui/PlaceField';

/**
 * Orbit Assist. Before a trip it asks one question, "Where are we going?". During
 * one it is the dashboard of a co-pilot that is already handling the charging:
 * a calm status, the one stop that matters, and proof that it is watching.
 */
export default function SmartDriveScreen(): React.JSX.Element {
  const trip = useApp(selectTrip);
  return trip ? <TripDashboard trip={trip} /> : <TripPlanner />;
}

/* ----------------------------------------------------------------- planner -- */

function TripPlanner(): React.JSX.Element {
  const { width, height } = useWindowDimensions();
  const nav = useNavigation();
  const active = useIsActiveRef();
  const { smartDrive } = useServices();
  const vehicle = useApp(selectActiveVehicle);
  const battery = useApp(s => s.battery);
  const reserve = useApp(s => s.tripPrefs.minArrivalSocPct);
  const mode = useApp(s => assistModeOf(s.smartDrive.prefs));
  const { params } = useRoute<'SmartDrive'>();
  const [from, setFrom] = useState('');
  const [fromCoords, setFromCoords] = useState<Coords | undefined>();
  const [locating, setLocating] = useState(true);
  const [locationError, setLocationError] = useState<string | null>(null);
  const locationRequest = useRef(0);
  const submitting = useRef(false);
  const locate = async () => {
    const request = ++locationRequest.current;
    setLocating(true);
    setLocationError(null);
    try {
      const coords = await getCurrentLocation();
      if (active.current && request === locationRequest.current) {
        setFrom('Current location');
        setFromCoords(coords);
      }
    } catch (e) {
      if (active.current && request === locationRequest.current) {
        setLocationError(
          e instanceof Error
            ? e.message
            : 'Location unavailable. Enter your starting city.',
        );
      }
    } finally {
      if (active.current && request === locationRequest.current) {
        setLocating(false);
      }
    }
  };
  useEffect(() => {
    locate();
    return () => {
      locationRequest.current += 1;
    };
    // Get one fix on entry; changing the origin must not trigger another request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Home's "Where are we going?" hands its destination over here.
  const [to, setTo] = useState(params?.toLabel ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; body: string } | null>(
    null,
  );

  if (!vehicle) {
    return (
      <Screen title="Orbit Assist">
        <EmptyState
          icon="car"
          title="Add your car first"
          body="Orbit Assist plans every charge around your battery size and the connectors your car can use."
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
    if (!ready || submitting.current) {
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await smartDrive.start({
        fromLabel: from.trim(),
        fromCoords,
        toLabel: to.trim(),
      });
    } catch (e) {
      if (active.current) {
        const copy = describeError(e, 'We couldn’t plan this trip.');
        setError({ title: copy.title, body: copy.body });
      }
    }
    submitting.current = false;
    if (active.current) {
      setBusy(false);
    }
  };

  return (
    <Screen
      title="Orbit Assist"
      stack
      right={
        <IconButton
          icon="sparkles"
          label="Talk to Orbit"
          onPress={() => nav.navigate('Assistant')}
        />
      }
      footer={
        height >= 700 ? (
          <PrimaryButton
            label="Start journey"
            icon="route"
            loading={busy}
            disabled={!ready}
            onPress={start}
          />
        ) : undefined
      }
    >
      <Text style={styles.lead}>Where are we going?</Text>
      <Card>
        <View style={styles.fields}>
          <PlaceField
            label="From"
            value={from}
            onChangeText={value => {
              locationRequest.current += 1;
              setLocating(false);
              setLocationError(null);
              setFromCoords(undefined);
              setFrom(value);
            }}
            placeholder={locating ? 'Finding your location…' : 'Start city'}
            icon="navigation"
          />
          <Text style={styles.locationNote} accessibilityLiveRegion="polite">
            {locating
              ? 'Finding your current location…'
              : locationError ??
                (fromCoords
                  ? 'Using your device location. You can enter a different start.'
                  : 'Enter a starting city or use your location.')}
          </Text>
          <TextButton
            label="Use current location"
            icon="navigation"
            onPress={() => {
              if (!locating) {
                locate();
              }
            }}
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

      {height < 700 && (
        <PrimaryButton
          label="Start journey"
          icon="route"
          loading={busy}
          disabled={!ready}
          onPress={start}
        />
      )}

      <SectionTitle title="How should we help?" />
      <AssistModeSelector mode={mode} onChange={m => smartDrive.setMode(m)} />
      <Card tone="dark">
        <Text style={styles.kicker}>Orbit Assist</Text>
        <Text style={[styles.heroTitle, width < 360 && styles.compactTitle]}>
          {PHRASES.tagline}
        </Text>
        <Text style={styles.heroBody}>
          {mode === 'guided'
            ? 'You decide, and we tell you what your plan needs.'
            : 'We recommend charging stops and a backup, and keep watching. You approve every change.'}
        </Text>
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

      {RUNS_ON_DEMO_DATA && (
        <Notice
          tone="info"
          title="Preview data"
          body="Your starting point can use device GPS. Routes, charger availability and journey monitoring are simulated in this version, so treat plans as a preview."
        />
      )}
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

function TripDashboard({ trip }: { trip: ActiveTrip }): React.JSX.Element {
  const nav = useNavigation();
  const active = useIsActiveRef();
  const { smartDrive } = useServices();
  const vehicle = useApp(selectActiveVehicle);
  const mode = useApp(s => assistModeOf(s.smartDrive.prefs));
  const now = useTripNow(trip.clockOffsetMs, 15_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ title: string; body: string } | null>(
    null,
  );

  const { plan } = trip;
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
        setError({ title: copy.title, body: copy.body });
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
                  await openMaps({ id: 'dest', ...destination });
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
              onPress: () => openMaps({ id: 'dest', ...destination }),
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
      title="Orbit Assist"
      stack
      right={
        <IconButton
          icon="sparkles"
          label="Talk to Orbit"
          onPress={() => nav.navigate('Assistant')}
        />
      }
      footer={
        <>
          {!ended && trip.monitoringState !== 'ended' && (
            <MonitoringFooter
              text={
                trip.network === 'offline'
                  ? 'Offline. Your plan is saved on this phone.'
                  : mode === 'guided'
                  ? 'Guided: we’ll tell you what your plan needs.'
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
      }
    >
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
  const { smartDrive } = useServices();
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
  lead: { ...type.display, color: colors.ink },
  kicker: { ...type.micro, color: colors.lime, textTransform: 'uppercase' },
  heroTitle: { ...type.h1, color: '#FFFFFF', marginTop: 6 },
  heroBody: {
    ...type.body,
    color: colors.chipText,
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  fields: { gap: spacing.sm },
  row: { marginTop: spacing.md },
  links: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  route: { ...type.h1, color: colors.ink, marginBottom: spacing.sm },
  center: { alignItems: 'center' },
  demoTitle: { ...type.heading, color: colors.ink },
  demoBody: {
    ...type.caption,
    color: colors.muted,
    marginTop: 4,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  demoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  half: { flexGrow: 1, flexBasis: 140 },
  compactTitle: { fontSize: 22, lineHeight: 28 },
  locationNote: { ...type.caption, color: colors.muted, flexShrink: 1 },
});
