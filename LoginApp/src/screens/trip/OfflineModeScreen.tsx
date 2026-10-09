import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {DEFAULT_CENTER} from '../../config/google';
import {stationHealth} from '../../domain/rules';
import {timeAgo} from '../../domain/trust';
import {buildOfflineView} from '../../intelligence/offline';
import type {StationWithDistance} from '../../domain/types';
import {useIsFocused, useNavigation} from '../../navigation/NavigationContext';
import {useServices} from '../../services';
import {selectActiveVehicle, selectTrip, useApp} from '../../store/appStore';
import {useDemo} from '../../store/demoStore';
import {colors, spacing, type} from '../../theme';
import {
  Card,
  ConfidenceBadge,
  EmptyState,
  Notice,
  Pill,
  PrimaryButton,
  Screen,
  SecondaryButton,
  showToast,
  StatusBadge,
  ToggleRow,
  useNow,
} from '../../ui';

const AUTO_RETRY_MS = 15_000;

/**
 * 35 Offline highway mode. What you chose is cached, so it's still here with no
 * signal. Statuses are LAST-KNOWN: they are labelled with their age and are
 * never presented as live.
 */
export default function OfflineModeScreen(): React.JSX.Element {
  const nav = useNavigation();
  const focused = useIsFocused();
  const now = useNow(15_000);
  const {station: stationService} = useServices();
  const route = useApp(s => s.activeRoute);
  const trip = useApp(selectTrip);
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

  // A Smart Drive trip carries its own offline plan: the chosen stop, its
  // backup, connector and access details, every status shown with its age.
  const smart = buildOfflineView(trip, now + (trip?.clockOffsetMs ?? 0));

  if (!route && !smart) {
    return (
      <Screen title="Offline trip mode">
        <EmptyState
          icon="wifi-off"
          title="Nothing saved for offline"
          body="Plan a trip while you have signal. We cache the route, your chosen charger and its backup so they work in dead zones."
          primary={{
            label: 'Plan a trip',
            icon: 'route',
            onPress: () => nav.replace('RoutePlanner'),
          }}
        />
      </Screen>
    );
  }

  const stations: Array<{role: string; station: StationWithDistance}> = (
    route?.stops ?? []
  ).flatMap((s, i) => [
    {role: `Stop ${i + 1}`, station: s.station},
    ...(s.backup
      ? [{role: `Backup for stop ${i + 1}`, station: s.backup}]
      : []),
  ]);
  const unbacked = (route?.stops ?? []).filter(s => !s.backup).length;

  return (
    <Screen
      title="Offline trip mode"
      stack
      footer={
        <PrimaryButton
          label={route ? 'Open cached route' : 'Open Smart Drive'}
          icon={route ? 'route' : 'sparkles'}
          onPress={() => nav.navigate(route ? 'RouteResult' : 'SmartDrive')}
        />
      }>
      <Text style={styles.lead}>
        {offline ? 'Weak network detected' : 'Ready for a weak network'}
      </Text>
      <Notice
        tone={offline ? 'warn' : 'info'}
        icon="wifi-off"
        title={offline ? 'You’re offline' : 'Your trip is saved on this phone'}
        body={`${route ? route.fromLabel : trip?.origin.label} → ${
          route ? route.toLabel : trip?.destination.label
        }: route, chosen charger and backup are cached. Statuses below are last-known, not live.`}
      />

      {smart && (
        <>
          <Text style={styles.section}>Smart Drive plan</Text>
          <Card tone="lime">
            <Text style={styles.name}>{smart.subline}</Text>
            <Text style={styles.fine}>{smart.lastUpdate}</Text>
          </Card>
          {smart.stops.map(s => (
            <Card key={`${s.role}-${s.stationId}`}>
              <Text style={styles.role}>
                {s.role === 'primary' ? 'Your stop' : 'Your backup'}
              </Text>
              <Text style={styles.name}>{s.name}</Text>
              <Text style={styles.fine}>
                {s.connectorLabel} • {s.connectorType} • {s.chargerKw} kW •{' '}
                {s.hours}
              </Text>
              <View style={styles.badges}>
                <Pill
                  label={s.status.label}
                  tone={s.status.trust === 'unknown' ? 'slate' : 'amber'}
                />
              </View>
              <Text style={styles.fine}>{s.price}</Text>
              <Text style={styles.fine}>{s.instructions ?? s.access}</Text>
            </Card>
          ))}
        </>
      )}

      {route && unbacked > 0 && (
        <Notice
          tone="warn"
          title={`No backup for ${unbacked} of ${route.stops.length} ${
            route.stops.length === 1 ? 'stop' : 'stops'
          }`}
          body="No compatible charger is close enough to be a backup there. Check the charger before you rely on it."
        />
      )}

      {stations.length > 0 && (
        <Text style={styles.section}>Cached route chargers</Text>
      )}
      {stations.map(({role, station}) => (
        <Card key={`${role}-${station.id}`}>
          <Text style={styles.role}>{role}</Text>
          <Text style={styles.name}>{station.name}</Text>
          <View style={styles.badges}>
            <StatusBadge
              status={
                stationHealth(station, vehicle) === 'available'
                  ? 'available'
                  : stationHealth(station, vehicle) === 'offline'
                  ? 'offline'
                  : stationHealth(station, vehicle) === 'busy'
                  ? 'occupied'
                  : 'unknown'
              }
            />
            <ConfidenceBadge
              feed={station.statusFeed}
              now={now}
              subject="Last-known status"
            />
          </View>
          <Text style={styles.fine}>
            Last known {timeAgo(station.statusFeed.updatedAt, now)}. We can’t
            confirm it without signal.
          </Text>
        </Card>
      ))}

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
          body="Open your route to see refreshed statuses."
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

const styles = StyleSheet.create({
  lead: {...type.display, color: colors.ink},
  section: {...type.heading, color: colors.ink, marginTop: spacing.sm},
  role: {...type.micro, color: colors.muted, textTransform: 'uppercase'},
  name: {...type.heading, color: colors.ink, marginTop: 4},
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: spacing.md,
  },
  fine: {...type.caption, color: colors.muted, marginTop: spacing.sm},
});
