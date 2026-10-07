import React, {useEffect, useMemo, useRef} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {nearestAlternative} from '../../domain/alternative';
import {availableCount, stationHealth} from '../../domain/rules';
import {timeAgo} from '../../domain/trust';
import type {RouteStop, StationWithDistance} from '../../domain/types';
import {useUserOrigin} from '../../hooks/useUserOrigin';
import {
  useIsFocused,
  useNavigation,
  useRoute,
} from '../../navigation/NavigationContext';
import {useServices} from '../../services';
import {openDirections} from '../../services/directions';
import {selectActiveVehicle, useApp} from '../../store/appStore';
import {colors, spacing, type} from '../../theme';
import {formatClock} from '../../utils/format';
import {formatDistance} from '../../utils/geo';
import {
  AsyncView,
  BackupChargerCard,
  Card,
  ConfidenceBadge,
  healthBadge,
  Notice,
  Pill,
  PrimaryButton,
  Screen,
  SecondaryButton,
  showToast,
  StationMiniMap,
  TextButton,
  useNow,
  useResource,
} from '../../ui';

const WATCH_MS = 10_000;
const AVG_KMH = 55;

/**
 * 11 Navigation hand-off. Google Maps does the turn-by-turn; we keep watching
 * the charger and move you to the backup if it fills up or goes offline.
 */
export default function NavigationScreen(): React.JSX.Element {
  const nav = useNavigation();
  const {params} = useRoute<'Navigation'>();
  const focused = useIsFocused();
  const {station: stationService} = useServices();
  const vehicle = useApp(selectActiveVehicle);
  const route = useApp(s => s.activeRoute);
  const {origin, known, ready, demoArea} = useUserOrigin();
  const now = useNow(15_000);
  const handled = useRef(false);

  const res = useResource(
    () => stationService.get(params.stationId, origin),
    [params.stationId, origin.latitude, origin.longitude],
    {enabled: ready},
  );

  // "Status watch": poll while the screen is visible.
  const {reload} = res;
  useEffect(() => {
    if (!focused || !ready) {
      return;
    }
    const id = setInterval(reload, WATCH_MS);
    return () => clearInterval(id);
  }, [focused, ready, reload]);

  // Is the charger a stop on the cached plan? Then its planned backup applies.
  const stopIndex = useMemo(() => {
    if (!route) {
      return -1;
    }
    const hinted = params.stopIndex;
    return hinted !== undefined &&
      route.stops[hinted]?.station.id === params.stationId
      ? hinted
      : route.stops.findIndex(s => s.station.id === params.stationId);
  }, [route, params.stopIndex, params.stationId]);

  // The watched charger can no longer be used: go to the backup alert, once.
  const data = res.data;
  useEffect(() => {
    if (!data || handled.current || !focused) {
      return;
    }
    const free = availableCount(data, vehicle) > 0;
    const health = stationHealth(data, vehicle);
    if (!free && (health === 'busy' || health === 'offline')) {
      handled.current = true;
      showToast(
        health === 'offline'
          ? `${data.name} is offline right now.`
          : `${data.name} has no free bay right now.`,
        'warn',
      );
      // The alert is about the charger we are heading to, not the plan's.
      nav.replace('BackupAlert', {
        stationId: data.id,
        stopIndex: stopIndex >= 0 ? stopIndex : undefined,
        reason: health === 'offline' ? 'offline' : 'occupied',
      });
    }
  }, [data, vehicle, focused, nav, stopIndex]);

  const stop = stopIndex >= 0 ? route?.stops[stopIndex] : undefined;

  return (
    <Screen title="Navigate" stack>
      <AsyncView
        resource={res}
        errorTitle="Couldn’t load this charger"
        loading={
          <Card>
            <Text style={styles.sub}>Finding the way…</Text>
          </Card>
        }
        render={station => (
          <Body
            station={station}
            origin={origin}
            known={known}
            demoArea={demoArea}
            now={now}
            stop={stop}
          />
        )}
      />
    </Screen>
  );
}

function Body({
  station,
  origin,
  known,
  demoArea,
  now,
  stop,
}: {
  station: StationWithDistance;
  origin: {latitude: number; longitude: number};
  known: boolean;
  demoArea: boolean;
  now: number;
  /** The plan's stop for this charger, when it is one. */
  stop?: RouteStop;
}) {
  const nav = useNavigation();
  const {station: stationService} = useServices();
  const vehicle = useApp(selectActiveVehicle);
  const health = stationHealth(station, vehicle);
  const updated =
    station.statusFeed.updatedAt === null
      ? 'never updated'
      : `updated ${timeAgo(station.statusFeed.updatedAt, now)}`;
  const planned = stop?.backup ?? null;
  // Off the plan (Home, Compare, Station detail) there is no planned backup:
  // offer the nearest compatible alternative to this charger instead.
  const alt = useResource(
    async () => {
      const near = await stationService.nearby({origin: station, vehicle});
      return {backup: nearestAlternative(near, station.id, vehicle)};
    },
    [station.id, vehicle?.id ?? null],
    {enabled: planned === null},
  );
  const backup = planned ?? alt.data?.backup ?? null;
  const backupExtra = planned
    ? stop?.backupExtraMin ?? 0
    : Math.max(3, backup?.detourMin ?? 0);
  const driveMin = Math.max(2, Math.round((station.distanceKm / AVG_KMH) * 60));
  const arrive = now + driveMin * 60_000;

  const open = async () => {
    const ok = await openDirections(station);
    if (!ok) {
      showToast('Couldn’t open Google Maps. Is it installed?', 'warn');
    }
  };

  return (
    <>
      <StationMiniMap from={origin} to={station} height={210} />

      <Card tone="dark">
        <Text style={styles.kicker}>Heading to</Text>
        <Text style={styles.title}>{station.name}</Text>
        <Text style={styles.heroSub}>
          {formatDistance(station.distanceKm)} • about {driveMin} min • arrive{' '}
          {formatClock(arrive)}
        </Text>
        {(!known || demoArea) && (
          <Text style={styles.warn}>
            {demoArea
              ? 'You’re far from the demo chargers, so distance is measured from New Delhi.'
              : 'Location is off, so distance is measured from New Delhi.'}
          </Text>
        )}
      </Card>

      <Card tone="lime">
        <View style={styles.watchRow}>
          {health !== 'unknown' && (
            <Pill label="Status watch ON" tone="lime" dot />
          )}
          <ConfidenceBadge
            feed={station.statusFeed}
            now={now}
            subject="Status"
          />
        </View>
        <View style={styles.statusRow}>
          {healthBadge(health)}
          <Text style={styles.sub}>
            {health === 'unknown'
              ? `Status unknown (${updated}). We can’t see this charger’s status, so we can’t alert you. Check it when you arrive.`
              : 'We’ll alert you if it changes, and move you to your backup.'}
          </Text>
        </View>
      </Card>

      {backup ? (
        <BackupChargerCard
          station={backup}
          vehicle={vehicle}
          now={now}
          extraMin={backupExtra}
          onPress={() => nav.navigate('StationDetail', {stationId: backup.id})}
        />
      ) : (
        alt.status === 'ready' && (
          <Notice
            tone="warn"
            title="No backup nearby"
            body={
              stop?.backupNote ??
              'No other compatible charger is within reach of this one. Check it before you set off.'
            }
          />
        )
      )}

      <PrimaryButton label="Open navigation" icon="navigation" onPress={open} />
      <SecondaryButton
        label="I’ve arrived — scan charger"
        icon="scan-line"
        onPress={() => nav.navigate('ScanQr', {stationId: station.id})}
      />
      <View style={styles.center}>
        <TextButton
          label="Change charger"
          tone="muted"
          onPress={() => nav.navigate('StationList')}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  kicker: {...type.micro, color: colors.lime, textTransform: 'uppercase'},
  title: {...type.h1, color: '#FFFFFF', marginTop: 6},
  heroSub: {...type.body, color: colors.chipText, marginTop: 6},
  warn: {...type.caption, color: '#FCD34D', marginTop: spacing.sm},
  sub: {...type.caption, color: colors.inkSoft, flex: 1},
  watchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  center: {alignItems: 'center'},
});
