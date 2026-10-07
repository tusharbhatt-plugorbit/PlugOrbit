import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {describeError} from '../../domain/describeError';
import {useNavigation} from '../../navigation/NavigationContext';
import {useServices} from '../../services';
import {selectActiveVehicle, useApp} from '../../store/appStore';
import {cacheRoute} from '../../store/tripActions';
import {colors, spacing, type} from '../../theme';
import {
  Card,
  EmptyState,
  Icon,
  IconButton,
  Notice,
  PrimaryButton,
  Screen,
  SecondaryButton,
} from '../../ui';
import {PlaceField} from '../../ui/PlaceField';

/** 39 Multi-stop trip: plan a whole day, with charging between the stops. */
export default function MultiStopScreen(): React.JSX.Element {
  const nav = useNavigation();
  const {route: routeService} = useServices();
  const vehicle = useApp(selectActiveVehicle);
  const battery = useApp(s => s.battery);
  const prefs = useApp(s => s.tripPrefs);

  const [stops, setStops] = useState<string[]>(['Delhi', 'Neemrana', 'Jaipur']);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!vehicle) {
    return (
      <Screen title="Multi-stop trip">
        <EmptyState
          icon="car"
          title="Add your car first"
          body="We plan the charging between stops for your car."
          primary={{
            label: 'Add your EV',
            onPress: () => nav.navigate('VehicleSetup'),
          }}
        />
      </Screen>
    );
  }

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= stops.length) {
      return;
    }
    const next = [...stops];
    [next[i], next[j]] = [next[j], next[i]];
    setStops(next);
  };
  const remove = (i: number) => setStops(stops.filter((_, k) => k !== i));
  const addStop = () => {
    const name = draft.trim();
    if (name) {
      setStops([...stops, name]);
    }
    setDraft('');
    setAdding(false);
  };

  const valid = stops.length >= 2 && battery !== null;

  const recalc = async () => {
    if (!valid || battery === null) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const route = await routeService.plan({
        fromLabel: stops[0],
        toLabel: stops[stops.length - 1],
        via: stops.slice(1, -1),
        startSoc: battery.percent,
        strategy: prefs.strategy,
        vehicle,
        safetyReservePct: prefs.minArrivalSocPct,
        avoidPaidParking: prefs.avoidPaidParking,
      });
      cacheRoute(route);
      nav.navigate('RouteResult');
    } catch (e) {
      setError(describeError(e, 'We couldn’t plan this trip.').body);
    }
    setBusy(false);
  };

  return (
    <Screen
      title="Multi-stop trip"
      stack
      footer={
        <PrimaryButton
          label="Recalculate"
          icon="route"
          loading={busy}
          disabled={!valid}
          onPress={recalc}
        />
      }>
      <Text style={styles.lead}>Plan the full day</Text>
      <Text style={styles.sub}>We add the charging between your stops.</Text>

      <Card>
        {stops.map((s, i) => (
          <View key={`${s}-${i}`} style={styles.row}>
            <View
              style={[
                styles.dot,
                i === 0 && styles.dotStart,
                i === stops.length - 1 && styles.dotEnd,
              ]}>
              <Text style={[styles.dotText, i === 0 && styles.dotTextOnDark]}>
                {i === 0 ? 'A' : i === stops.length - 1 ? 'B' : i}
              </Text>
            </View>
            <Text style={styles.stop} numberOfLines={1}>
              {s}
            </Text>
            <IconButton
              icon="chevron-up"
              label={`Move ${s} up`}
              size={36}
              onPress={() => move(i, -1)}
            />
            <IconButton
              icon="chevron-down"
              label={`Move ${s} down`}
              size={36}
              onPress={() => move(i, 1)}
            />
            <IconButton
              icon="trash2"
              label={`Remove ${s}`}
              size={36}
              onPress={() => remove(i)}
            />
          </View>
        ))}
        {stops.length === 0 && (
          <View style={styles.empty}>
            <Icon name="map-pin" size={20} color={colors.placeholder} />
            <Text style={styles.sub}>No stops yet.</Text>
          </View>
        )}
      </Card>

      {adding ? (
        <Card>
          <PlaceField
            label="Add destination"
            value={draft}
            onChangeText={setDraft}
            placeholder="City"
          />
          <View style={styles.addRow}>
            <SecondaryButton
              label="Cancel"
              compact
              onPress={() => {
                setAdding(false);
                setDraft('');
              }}
            />
            <PrimaryButton
              label="Add"
              compact
              disabled={!draft.trim()}
              onPress={addStop}
            />
          </View>
        </Card>
      ) : (
        <SecondaryButton
          label="Add destination"
          icon="plus"
          onPress={() => setAdding(true)}
        />
      )}

      {stops.length < 2 && (
        <Notice
          tone="warn"
          title="Add at least two places"
          body="A trip needs a start and a destination."
        />
      )}
      {battery === null && (
        <Notice
          tone="warn"
          title="Set your battery first"
          body="We need it to plan the charging."
        />
      )}
      {error && (
        <Notice tone="danger" title="Couldn’t plan this trip" body={error} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: {...type.display, color: colors.ink},
  sub: {...type.body, color: colors.muted},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 6,
  },
  dot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.slateSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotStart: {backgroundColor: colors.bg},
  dotEnd: {backgroundColor: colors.lime},
  dotText: {...type.micro, color: colors.ink},
  dotTextOnDark: {color: '#FFFFFF'},
  stop: {...type.bodyStrong, color: colors.ink, flex: 1},
  empty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  addRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
});
