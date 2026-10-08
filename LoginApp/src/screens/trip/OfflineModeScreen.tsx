import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {OfflineStop} from '../../domain/activeTrip';
import {DEFAULT_CENTER} from '../../config/google';
import {stationHealth} from '../../domain/rules';
import {timeAgo} from '../../domain/trust';
import type {
  FeedInfo,
  FeedSource,
  StationWithDistance,
} from '../../domain/types';
import {useIsFocused, useNavigation} from '../../navigation/NavigationContext';
import {useServices} from '../../services';
import {selectActiveVehicle, useApp} from '../../store/appStore';
import {useDemo} from '../../store/demoStore';
import {colors, spacing, type} from '../../theme';
import {formatInr} from '../../utils/format';
import {
  Card,
  ConfidenceBadge,
  EmptyState,
  Notice,
  PrimaryButton,
  RouteMap,
  Screen,
  SecondaryButton,
  showToast,
  StatusBadge,
  ToggleRow,
  useNow,
} from '../../ui';

const AUTO_RETRY_MS = 15_000;

/**
 * Whatever an operator said is, offline, only what they said LAST. It is shown
 * as an estimate with its age and never as live, however recent.
 */
function lastKnown(source: string, updatedAt: number | null): FeedInfo {
  return {
    source: (source === 'operator_feed' ? 'estimate' : source) as FeedSource,
    updatedAt,
  };
}

function SavedStopCard({stop, now}: {stop: OfflineStop; now: number}) {
  const feed = lastKnown(stop.statusSource, stop.statusUpdatedAt);
  return (
    <Card testID={`saved-${stop.role}`}>
      <Text style={styles.role}>
        {stop.role === 'primary' ? 'Your charging stop' : 'Your backup'}
      </Text>
      <Text style={styles.name}>{stop.name}</Text>
      <Text style={styles.sub}>
        {stop.operator} • {stop.address}
      </Text>
      <View style={styles.badges}>
        <ConfidenceBadge feed={feed} now={now} subject="Last-known status" />
      </View>
      <Text style={styles.line}>
        Use {stop.connectorLabel} • {stop.connectorType} • {stop.powerKw} kW
      </Text>
      <Text style={styles.fine}>
        {stop.freeBays === null
          ? 'We couldn’t see the bays when this was saved.'
          : `${stop.freeBays} of ${
              stop.totalBays
            } bays were free when last seen, ${timeAgo(
              stop.statusUpdatedAt,
              now,
            )}. We can’t confirm that without signal.`}
      </Text>
      <Text style={styles.fine}>
        {stop.pricePerKwh === null
          ? 'Price not published.'
          : `${formatInr(
              stop.pricePerKwh,
              stop.pricePerKwh % 1 !== 0,
            )}/kWh, last updated ${timeAgo(stop.priceUpdatedAt, now)}.`}
      </Text>
      <View style={styles.rule} />
      <Text style={styles.label}>How to start</Text>
      <Text style={styles.body}>{stop.accessInstructions}</Text>
      <Text style={[styles.label, styles.gap]}>If something’s wrong</Text>
      <Text style={styles.body}>{stop.help}</Text>
      <Text style={[styles.fine, styles.gap]}>
        About {Math.max(0, stop.kmAhead)} km ahead when saved •{' '}
        {stop.latitude.toFixed(4)}, {stop.longitude.toFixed(4)}
      </Text>
    </Card>
  );
}

/**
 * 35 Offline trip mode. What PlugOrbit keeps on the phone so the charging plan
 * still works in a dead zone: the route, the planned charger and its backup,
 * how to start, who to ask, and the last-known status and price, each with its
 * age. Nothing here is ever presented as live.
 */
export default function OfflineModeScreen(): React.JSX.Element {
  const nav = useNavigation();
  const focused = useIsFocused();
  const now = useNow(15_000);
  const {station: stationService, offline: offlineService} = useServices();
  const snapshot = useApp(s => s.offlineTrip);
  const trip = useApp(s => s.activeTrip);
  const route = useApp(s => s.activeRoute);
  const vehicle = useApp(selectActiveVehicle);
  const offline = useDemo(s => s.offline);

  const [auto, setAuto] = useState(true);
  const [checking, setChecking] = useState(false);
  const [lastTry, setLastTry] = useState<number | null>(null);
  const [result, setResult] = useState<'ok' | 'offline' | null>(null);

  const check = async (manual: boolean) => {
    setChecking(true);
    try {
      await stationService.nearby({origin: DEFAULT_CENTER, vehicle});
      setResult('ok');
      if (manual) {
        showToast('Back online. Statuses are refreshing.', 'success');
      }
    } catch {
      setResult('offline');
      if (manual) {
        showToast('Still no signal. We’ll keep your saved plan ready.', 'warn');
      }
    }
    setLastTry(Date.now());
    setChecking(false);
  };

  useEffect(() => {
    if (!auto || !focused) {
      return;
    }
    const id = setInterval(() => check(false), AUTO_RETRY_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, focused, vehicle?.id]);

  const saved = snapshot ?? offlineService.load();

  // The plan saved by a trip in progress.
  if (saved) {
    const unbacked = !saved.stops.some(s => s.role === 'backup');
    return (
      <Screen
        title="Offline trip mode"
        stack
        footer={
          <PrimaryButton
            label={trip ? 'Back to my trip' : 'Open cached route'}
            icon={trip ? 'navigation' : 'route'}
            onPress={() =>
              trip ? nav.navigate('SmartDrive') : nav.navigate('RouteResult')
            }
          />
        }>
        <Text style={styles.lead}>
          {offline ? 'You’re offline' : 'Ready for a weak network'}
        </Text>
        <Notice
          tone={offline ? 'warn' : 'info'}
          icon="wifi-off"
          title={
            offline ? 'OFFLINE TRIP MODE' : 'Your plan is saved on this phone'
          }
          body={
            offline
              ? `You’re offline. We’ve kept your charging plan available. Last updated ${timeAgo(
                  saved.savedAt,
                  now,
                )}.`
              : `${saved.origin} → ${
                  saved.destination
                }: route, charger, backup and how to start are saved. Last updated ${timeAgo(
                  saved.savedAt,
                  now,
                )}.`
          }
        />
        <RouteMap route={saved.route} height={170} highlightStop={0} />
        {saved.stops.length === 0 ? (
          <Notice
            tone="lime"
            title="No charging stop needed"
            body={`You have enough battery to reach ${saved.destination}.`}
          />
        ) : (
          saved.stops.map(stop => (
            <SavedStopCard
              key={`${stop.role}-${stop.stationId}`}
              stop={stop}
              now={now}
            />
          ))
        )}
        {unbacked && saved.stops.length > 0 && (
          <Notice
            tone="warn"
            title="No backup saved for this stop"
            body="No compatible charger was close enough to be a backup. Check the charger before you rely on it."
          />
        )}
        <Card>
          <ToggleRow
            title="Retry automatically"
            subtitle="Check for signal every 15 seconds and refresh statuses when it returns"
            value={auto}
            onValueChange={setAuto}
            last
          />
        </Card>
        {result === 'offline' && (
          <Notice
            tone="warn"
            title="Still no signal"
            body={`Last tried ${timeAgo(lastTry, now)}.`}
          />
        )}
        {result === 'ok' && (
          <Notice
            tone="lime"
            title="Signal is back"
            body="Open your trip to see refreshed statuses."
          />
        )}
        <SecondaryButton
          label="Retry now"
          icon="refresh-cw"
          loading={checking}
          onPress={() => check(true)}
        />
      </Screen>
    );
  }

  if (!route) {
    return (
      <Screen title="Offline trip mode">
        <EmptyState
          icon="wifi-off"
          title="Nothing saved for offline"
          body="Start a trip while you have signal. We keep the route, your charger and its backup on this phone for dead zones."
          primary={{
            label: 'Plan a trip',
            icon: 'route',
            onPress: () => nav.replace('RoutePlanner'),
          }}
        />
      </Screen>
    );
  }

  // A planned route with no trip started yet: show what would be saved.
  const stations: Array<{role: string; station: StationWithDistance}> =
    route.stops.flatMap((s, i) => [
      {role: `Stop ${i + 1}`, station: s.station},
      ...(s.backup
        ? [{role: `Backup for stop ${i + 1}`, station: s.backup}]
        : []),
    ]);
  return (
    <Screen
      title="Offline trip mode"
      stack
      footer={
        <PrimaryButton
          label="Open cached route"
          icon="route"
          onPress={() => nav.navigate('RouteResult')}
        />
      }>
      <Text style={styles.lead}>Ready for a weak network</Text>
      <Notice
        tone="info"
        icon="wifi-off"
        title="Start the trip to save it"
        body={`${route.fromLabel} → ${route.toLabel}: once you start, the route, chosen charger and backup are saved on this phone. Statuses below are last-known, not live.`}
      />
      {stations.map(({role, station}) => {
        const health = stationHealth(station, vehicle);
        return (
          <Card key={`${role}-${station.id}`}>
            <Text style={styles.role}>{role}</Text>
            <Text style={styles.name}>{station.name}</Text>
            <View style={styles.badges}>
              <StatusBadge
                status={
                  health === 'available'
                    ? 'available'
                    : health === 'offline'
                    ? 'offline'
                    : health === 'busy'
                    ? 'occupied'
                    : 'unknown'
                }
              />
              <ConfidenceBadge
                feed={lastKnown(
                  station.statusFeed.source,
                  station.statusFeed.updatedAt,
                )}
                now={now}
                subject="Last-known status"
              />
            </View>
            <Text style={styles.fine}>
              Last known {timeAgo(station.statusFeed.updatedAt, now)}. We can’t
              confirm it without signal.
            </Text>
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: {...type.display, color: colors.ink},
  role: {...type.micro, color: colors.muted, textTransform: 'uppercase'},
  name: {...type.h1, color: colors.ink, marginTop: 4},
  sub: {...type.caption, color: colors.inkSoft, marginTop: 2},
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: spacing.md,
  },
  line: {...type.bodyStrong, color: colors.ink, marginTop: spacing.md},
  fine: {...type.caption, color: colors.muted, marginTop: spacing.sm},
  rule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
    marginVertical: spacing.md,
  },
  label: {...type.label, color: colors.ink},
  gap: {marginTop: spacing.md},
  body: {...type.caption, color: colors.inkSoft, marginTop: 2, lineHeight: 18},
});
