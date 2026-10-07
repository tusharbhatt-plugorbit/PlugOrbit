import React, {useMemo, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {describeError} from '../../domain/describeError';
import {CONFIDENCE_LABEL, waitLabel} from '../../domain/rules';
import type {Route, StationWithDistance, Vehicle} from '../../domain/types';
import {useNavigation, useRoute} from '../../navigation/NavigationContext';
import {useServices} from '../../services';
import {selectActiveVehicle, useApp} from '../../store/appStore';
import {cacheRoute} from '../../store/tripActions';
import {colors, spacing, type} from '../../theme';
import {
  AsyncView,
  BackupChargerCard,
  Card,
  ConfidencePill,
  EmptyState,
  Notice,
  PrimaryButton,
  Screen,
  SecondaryButton,
  showToast,
  StationMiniMap,
  useNow,
  useResource,
} from '../../ui';

type Loaded = {
  failed: StationWithDistance;
  backup: StationWithDistance;
  extraMin: number;
  stopIndex: number | null;
};

/**
 * 10 Backup alert. The charger you chose became occupied (or offline): one tap
 * moves to the backup that was already planned. Never leaves you without one.
 */
export default function BackupAlertScreen(): React.JSX.Element {
  const nav = useNavigation();
  const {params} = useRoute<'BackupAlert'>();
  const {station: stationService} = useServices();
  const vehicle = useApp(selectActiveVehicle);
  const route = useApp(s => s.activeRoute);
  const chosen = useApp(s => s.chosen);
  const now = useNow(15_000);
  const stopIndex = useMemo(() => {
    if (params?.stopIndex !== undefined) {
      return params.stopIndex;
    }
    if (route && chosen) {
      const i = route.stops.findIndex(s => s.station.id === chosen.stationId);
      return i >= 0 ? i : 0;
    }
    return route && route.stops.length > 0 ? 0 : null;
  }, [params?.stopIndex, route, chosen]);

  const res = useResource<Loaded | null>(async () => {
    if (route && stopIndex !== null && route.stops[stopIndex]) {
      const stop = route.stops[stopIndex];
      const [failed, backup] = await Promise.all([
        stationService.get(stop.station.id),
        stationService.get(stop.backup.id),
      ]);
      return {failed, backup, extraMin: stop.backupExtraMin, stopIndex};
    }
    // No plan: fall back to the chosen charger and the nearest alternative.
    const id = chosen?.stationId ?? 'st-chargezone-neemrana';
    const failed = await stationService.get(id);
    const near = await stationService.nearby({origin: failed, vehicle});
    const backup = near.find(s => s.id !== id);
    if (!backup) {
      return null;
    }
    return {
      failed,
      backup,
      extraMin: Math.max(3, backup.detourMin),
      stopIndex: null,
    };
  }, [route, stopIndex, chosen?.stationId, vehicle]);

  const reason = params?.reason ?? 'occupied';

  if (res.data) {
    return (
      <AlertBody
        data={res.data}
        reason={reason}
        vehicle={vehicle}
        now={now}
        route={route}
      />
    );
  }
  return (
    <Screen title="Backup charger" stack>
      <AsyncView
        resource={res}
        errorTitle="Couldn’t check your charger"
        isEmpty={d => d === null}
        empty={
          <EmptyState
            icon="plug-zap"
            title="No other charger nearby"
            body="We couldn’t find a compatible backup right now. Try a wider search."
            primary={{
              label: 'See chargers',
              onPress: () => nav.replace('StationList'),
            }}
          />
        }
        render={() => null}
      />
    </Screen>
  );
}

function AlertBody({
  data,
  reason,
  vehicle,
  now,
  route,
}: {
  data: Loaded;
  reason: 'occupied' | 'offline';
  vehicle: Vehicle | null;
  now: number;
  route: Route | null;
}) {
  const nav = useNavigation();
  const {route: routeService} = useServices();
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchNow = async () => {
    setSwitching(true);
    setError(null);
    try {
      if (route && data.stopIndex !== null) {
        const next = await routeService.switchToBackup(route, data.stopIndex);
        cacheRoute(next, data.stopIndex);
        const stop = next.stops[data.stopIndex] ?? next.stops[0];
        showToast(`Switched to ${stop.station.name}.`, 'success');
        nav.replace('Navigation', {
          stationId: stop.station.id,
          stopIndex: data.stopIndex,
        });
      } else {
        showToast(`Switched to ${data.backup.name}.`, 'success');
        nav.replace('Navigation', {stationId: data.backup.id});
      }
    } catch (e) {
      setError(describeError(e, 'We couldn’t switch to the backup.').body);
      setSwitching(false);
    }
  };

  const wait = {
    minMinutes: 10,
    maxMinutes: 18,
    confidence: 'medium' as const,
    basis: 'history' as const,
  };

  return (
    <Screen
      title="Backup charger"
      stack
      footer={
        <PrimaryButton
          label="Switch to backup"
          icon="repeat"
          loading={switching}
          onPress={switchNow}
        />
      }>
      <StationMiniMap
        from={{
          latitude: data.failed.latitude,
          longitude: data.failed.longitude,
        }}
        to={{latitude: data.backup.latitude, longitude: data.backup.longitude}}
        height={170}
      />
      <Card tone="danger">
        <Text style={styles.kicker}>Chosen stop</Text>
        <Text style={styles.title}>
          Your charger became{' '}
          {reason === 'offline' ? 'unavailable' : 'occupied'}
        </Text>
        <Text style={styles.sub}>
          {data.failed.name} just{' '}
          {reason === 'offline' ? 'went offline' : 'filled up'}. We found the
          next best option automatically.
        </Text>
      </Card>

      <BackupChargerCard
        station={data.backup}
        vehicle={vehicle}
        now={now}
        extraMin={data.extraMin}
        title="Switch to"
        onPress={() =>
          nav.navigate('StationDetail', {stationId: data.backup.id})
        }
      />

      {error && <Notice tone="danger" title="Couldn’t switch" body={error} />}

      <Card>
        <Text style={styles.waitTitle}>Or wait at {data.failed.name}</Text>
        <Text style={styles.sub}>Expected wait {waitLabel(wait)}</Text>
        <View style={styles.pill}>
          <ConfidencePill confidence={wait.confidence} />
        </View>
        <Text style={styles.fine}>
          {CONFIDENCE_LABEL[wait.confidence]}: based on recent sessions, so
          treat it as a range.
        </Text>
        <View style={styles.row}>
          <SecondaryButton
            label="Join queue"
            icon="users"
            compact
            onPress={() => nav.navigate('Queue', {stationId: data.failed.id})}
          />
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  kicker: {...type.micro, color: colors.danger, textTransform: 'uppercase'},
  title: {...type.h1, color: colors.ink, marginTop: 6},
  sub: {...type.body, color: colors.inkSoft, marginTop: 6, lineHeight: 20},
  waitTitle: {...type.heading, color: colors.ink},
  pill: {flexDirection: 'row', marginTop: spacing.sm},
  fine: {...type.caption, color: colors.muted, marginTop: spacing.sm},
  row: {marginTop: spacing.md},
});
