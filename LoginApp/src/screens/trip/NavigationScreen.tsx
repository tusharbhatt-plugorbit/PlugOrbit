import React, {useEffect, useRef} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {availableCount, stationHealth} from '../../domain/rules';
import type {StationWithDistance} from '../../domain/types';
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
  Pill,
  PrimaryButton,
  Screen,
  SecondaryButton,
  showToast,
  StationMiniMap,
  StatusBadge,
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
  const {origin, known, ready} = useUserOrigin();
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
      showToast(`${data.name} is no longer free.`, 'warn');
      nav.replace('BackupAlert', {
        stopIndex: params.stopIndex,
        reason: health === 'offline' ? 'offline' : 'occupied',
      });
    }
  }, [data, vehicle, focused, nav, params.stopIndex]);

  const stop =
    route && params.stopIndex !== undefined
      ? route.stops[params.stopIndex]
      : undefined;

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
            now={now}
            backup={stop?.backup}
            backupExtra={stop?.backupExtraMin}
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
  now,
  backup,
  backupExtra,
}: {
  station: StationWithDistance;
  origin: {latitude: number; longitude: number};
  known: boolean;
  now: number;
  backup?: StationWithDistance;
  backupExtra?: number;
}) {
  const nav = useNavigation();
  const vehicle = useApp(selectActiveVehicle);
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
        {!known && (
          <Text style={styles.warn}>
            Location is off, so distance is measured from New Delhi.
          </Text>
        )}
      </Card>

      <Card tone="lime">
        <View style={styles.watchRow}>
          <Pill label="Status watch ON" tone="lime" dot />
          <ConfidenceBadge
            feed={station.statusFeed}
            now={now}
            subject="Status"
          />
        </View>
        <View style={styles.statusRow}>
          <StatusBadge
            status={
              availableCount(station, vehicle) > 0 ? 'available' : 'occupied'
            }
          />
          <Text style={styles.sub}>
            We’ll alert you if it changes, and move you to your backup.
          </Text>
        </View>
      </Card>

      {backup && backupExtra !== undefined && (
        <BackupChargerCard
          station={backup}
          vehicle={vehicle}
          now={now}
          extraMin={backupExtra}
          onPress={() => nav.navigate('StationDetail', {stationId: backup.id})}
        />
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
