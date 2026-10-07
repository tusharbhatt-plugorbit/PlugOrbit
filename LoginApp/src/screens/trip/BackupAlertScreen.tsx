import React, {useMemo, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {nearestAlternative} from '../../domain/alternative';
import {describeError} from '../../domain/describeError';
import {CONFIDENCE_LABEL, waitBasisLabel, waitLabel} from '../../domain/rules';
import type {
  Route,
  StationWithDistance,
  Vehicle,
  WaitEstimate,
} from '../../domain/types';
import {
  useIsActiveRef,
  useNavigation,
  useRoute,
} from '../../navigation/NavigationContext';
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
  /** The route stop being replaced; null when the charger is not on the plan. */
  stopIndex: number | null;
  wait: WaitEstimate;
};

/**
 * 10 Backup alert. The charger you are heading to is occupied (or offline):
 * one tap moves to the backup that was already planned for it, or, off a
 * route, to its nearest alternative. Never about a charger you didn't choose.
 */
export default function BackupAlertScreen(): React.JSX.Element {
  const nav = useNavigation();
  const {params} = useRoute<'BackupAlert'>();
  const {station: stationService} = useServices();
  const vehicle = useApp(selectActiveVehicle);
  const route = useApp(s => s.activeRoute);
  const chosen = useApp(s => s.chosen);
  const now = useNow(15_000);
  const stationId = params?.stationId;
  const stopIndex = useMemo(() => {
    if (stationId !== undefined) {
      // Only a plan stop when the plan really has this charger at that index.
      if (!route) {
        return null;
      }
      const hinted = params?.stopIndex;
      const i =
        hinted !== undefined && route.stops[hinted]?.station.id === stationId
          ? hinted
          : route.stops.findIndex(s => s.station.id === stationId);
      return i >= 0 ? i : null;
    }
    if (params?.stopIndex !== undefined) {
      return params.stopIndex;
    }
    if (route && chosen) {
      const i = route.stops.findIndex(s => s.station.id === chosen.stationId);
      return i >= 0 ? i : 0;
    }
    return route && route.stops.length > 0 ? 0 : null;
  }, [stationId, params?.stopIndex, route, chosen]);

  const res = useResource<Loaded | null>(async () => {
    const stop =
      route && stopIndex !== null ? route.stops[stopIndex] : undefined;
    const failedId =
      stop?.station.id ??
      stationId ??
      chosen?.stationId ??
      'st-chargezone-neemrana';
    const [failed, wait] = await Promise.all([
      stationService.get(failedId),
      stationService.waitEstimate(failedId, vehicle),
    ]);
    if (stop?.backup && stopIndex !== null) {
      const backup = await stationService.get(stop.backup.id);
      return {failed, backup, extraMin: stop.backupExtraMin, stopIndex, wait};
    }
    // Not on the plan (or the plan has no backup for it): the nearest usable
    // alternative to *this* charger.
    const near = await stationService.nearby({origin: failed, vehicle});
    const backup = nearestAlternative(near, failed.id, vehicle);
    if (!backup) {
      return null;
    }
    return {
      failed,
      backup,
      extraMin: Math.max(3, backup.detourMin),
      stopIndex: null,
      wait,
    };
  }, [route, stopIndex, stationId, chosen?.stationId, vehicle]);

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
  const active = useIsActiveRef();
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchNow = async () => {
    setSwitching(true);
    setError(null);
    try {
      if (route && data.stopIndex !== null) {
        // The plan swaps in exactly the backup shown above.
        const next = await routeService.switchToBackup(route, data.stopIndex);
        if (!active.current) {
          return;
        }
        cacheRoute(next, data.stopIndex);
        const stop = next.stops[data.stopIndex];
        const target = stop ? stop.station : data.backup;
        showToast(`Switched to ${target.name}.`, 'success');
        nav.replace('Navigation', {
          stationId: target.id,
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

  const wait = data.wait;
  const waitKnown = wait.basis !== 'none';

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
          Your charger is {reason === 'offline' ? 'unavailable' : 'occupied'}
        </Text>
        <Text style={styles.sub}>
          {data.failed.name}{' '}
          {reason === 'offline'
            ? 'is offline right now'
            : 'has no free bay right now'}
          . We found the next best option automatically.
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
        {reason === 'offline' ? (
          <Text style={styles.sub}>
            Wait unknown. This charger is offline, so there is no queue to join.
          </Text>
        ) : (
          <>
            <Text style={styles.sub}>
              {waitKnown ? `Expected wait ${waitLabel(wait)}` : 'Wait unknown'}
            </Text>
            {waitKnown && (
              <View style={styles.pill}>
                <ConfidencePill confidence={wait.confidence} />
              </View>
            )}
            <Text style={styles.fine}>
              {CONFIDENCE_LABEL[wait.confidence]}. {waitBasisLabel(wait)}
            </Text>
            <View style={styles.row}>
              <SecondaryButton
                label="Join queue"
                icon="users"
                compact
                onPress={() =>
                  nav.navigate('Queue', {stationId: data.failed.id})
                }
              />
            </View>
          </>
        )}
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
