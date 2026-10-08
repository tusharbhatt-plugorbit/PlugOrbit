import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {describeError} from '../../domain/describeError';
import type {RouteStrategy} from '../../domain/types';
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
  Card,
  EmptyState,
  IconButton,
  Notice,
  PrimaryButton,
  Screen,
  SegmentedControl,
  TextButton,
  VehicleSelector,
} from '../../ui';
import {PlaceField} from '../../ui/PlaceField';

const STRATEGIES: ReadonlyArray<{value: RouteStrategy; label: string}> = [
  {value: 'fastest', label: 'Fastest'},
  {value: 'cheapest', label: 'Cheapest'},
  {value: 'reliable', label: 'Reliable'},
];

/** 08 Plan a trip. Plans with the active car, the current battery and your reserve. */
export default function RoutePlannerScreen(): React.JSX.Element {
  const nav = useNavigation();
  const active = useIsActiveRef();
  const {params} = useRoute<'RoutePlanner'>();
  const {route: routeService} = useServices();
  const vehicle = useApp(selectActiveVehicle);
  const battery = useApp(s => s.battery);
  const prefs = useApp(s => s.tripPrefs);

  const [from, setFrom] = useState(params?.fromLabel ?? 'Delhi');
  const [to, setTo] = useState(params?.toLabel ?? '');
  const [strategy, setStrategy] = useState<RouteStrategy>(prefs.strategy);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<{
    title: string;
    body: string;
    offline: boolean;
  } | null>(null);

  if (!vehicle) {
    return (
      <Screen title="Plan a trip">
        <EmptyState
          icon="car"
          title="Add your car first"
          body="We plan around your battery size and the connectors your car can use."
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

  const plan = async () => {
    if (!ready || soc === null) {
      return;
    }
    setPlanning(true);
    setError(null);
    try {
      const route = await routeService.plan({
        fromLabel: from.trim(),
        toLabel: to.trim(),
        startSoc: soc,
        strategy,
        vehicle,
        safetyReservePct: prefs.minArrivalSocPct,
        avoidPaidParking: prefs.avoidPaidParking,
      });
      // The user may have left while we planned: keep their saved trip as is.
      if (active.current) {
        cacheRoute(route);
        nav.navigate('TripSummary');
      }
    } catch (e) {
      const copy = describeError(e, 'We couldn’t plan this trip.');
      setError({
        title: copy.title,
        body:
          copy.kind === 'api'
            ? copy.body.replace(/^We couldn’t plan this trip\.\s*/, '')
            : copy.body,
        offline: copy.kind === 'offline',
      });
    }
    setPlanning(false);
  };

  return (
    <Screen
      title="Plan a trip"
      stack
      footer={
        <PrimaryButton
          label="Find best route"
          icon="route"
          loading={planning}
          disabled={!ready}
          onPress={plan}
        />
      }>
      <Text style={styles.lead}>Where to?</Text>

      <Card>
        <View style={styles.fields}>
          <PlaceField
            label="From"
            value={from}
            onChangeText={setFrom}
            placeholder="Start city"
            icon="navigation"
          />
          <View style={styles.swapRow}>
            <IconButton
              icon="arrow-up-down"
              label="Swap start and destination"
              size={40}
              onPress={() => {
                setFrom(to);
                setTo(from);
              }}
            />
          </View>
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
        <Text style={styles.label}>Starting battery</Text>
        <View style={styles.socRow}>
          <Text style={styles.soc}>{soc === null ? '—' : `${soc}%`}</Text>
          <TextButton
            label={soc === null ? 'Set battery' : 'Change'}
            icon="battery-charging"
            onPress={() => nav.navigate('ManualSoc')}
          />
        </View>
        <View style={styles.vehicle}>
          <VehicleSelector tone="light" />
        </View>
        <Text style={styles.fine}>
          We’ll keep at least {prefs.minArrivalSocPct}% in reserve.{' '}
        </Text>
        <TextButton
          label="Change safety reserve"
          tone="muted"
          onPress={() => nav.navigate('TripPreferences')}
        />
      </Card>

      <View>
        <Text style={styles.label}>Optimise for</Text>
        <View style={styles.seg}>
          <SegmentedControl
            options={STRATEGIES}
            value={strategy}
            onChange={setStrategy}
          />
        </View>
      </View>

      {soc === null && (
        <Notice
          tone="warn"
          title="Set your battery first"
          body="We need your current level to know where you’ll need to charge."
        />
      )}
      {error && (
        <Notice
          tone={error.offline ? 'warn' : 'danger'}
          title={error.title}
          body={error.body}
          action={
            !error.offline && /charge|reach/i.test(error.body) ? (
              <TextButton
                label="Update battery"
                onPress={() => nav.navigate('ManualSoc')}
              />
            ) : undefined
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: {...type.display, color: colors.ink},
  fields: {gap: spacing.sm},
  swapRow: {alignItems: 'flex-end', marginVertical: -4},
  label: {...type.label, color: colors.muted},
  socRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  soc: {fontSize: 34, fontWeight: '800', color: colors.ink},
  vehicle: {marginTop: spacing.sm},
  fine: {...type.caption, color: colors.muted, marginTop: spacing.md},
  seg: {marginTop: spacing.sm},
});
