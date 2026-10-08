import React, {useMemo, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {
  energyToCharge,
  invoiceFor,
  minutesToCharge,
} from '../../domain/charging';
import {lowestPrice} from '../../domain/rules';
import {useNavigation, useRoute} from '../../navigation/NavigationContext';
import {useServices} from '../../services';
import {selectActiveVehicle, useApp} from '../../store/appStore';
import {colors, spacing, type} from '../../theme';
import {formatDuration, formatInr} from '../../utils/format';
import {
  Card,
  EmptyState,
  KeyValue,
  Notice,
  PercentSlider,
  PriceLine,
  PrimaryButton,
  Screen,
  Stepper,
  useNow,
  useResource,
} from '../../ui';

/** 34 Charging cost: an estimate before you stop, with GST, for a SoC range. */
export default function CostCalculatorScreen(): React.JSX.Element {
  const nav = useNavigation();
  const {params} = useRoute<'CostCalculator'>();
  const {station: stationService} = useServices();
  const vehicle = useApp(selectActiveVehicle);
  const battery = useApp(s => s.battery);
  const now = useNow(30_000);
  const station = useResource(
    () => stationService.get(params?.stationId as string),
    [params?.stationId],
    {
      enabled: !!params?.stationId,
    },
  );

  const [from, setFrom] = useState(
    Math.min(95, Math.max(0, Math.round(battery?.percent ?? 20))),
  );
  const [to, setTo] = useState(80);
  const [manualPrice, setManualPrice] = useState<number | null>(null);

  const stationPrice = station.data ? lowestPrice(station.data, vehicle) : null;
  const price = manualPrice ?? stationPrice ?? 18;
  const target = Math.max(to, from + 5);

  const calc = useMemo(() => {
    if (!vehicle) {
      return null;
    }
    const kwh = energyToCharge(from, target, vehicle.batteryKwh);
    const inv = invoiceFor(kwh, price);
    const power = Math.min(
      station.data?.connectors[0]?.powerKw ?? 50,
      vehicle.maxDcKw || 50,
    );
    return {
      kwh,
      inv,
      minutes: minutesToCharge(from, target, power, vehicle.batteryKwh),
    };
  }, [vehicle, from, target, price, station.data]);

  if (!vehicle || !calc) {
    return (
      <Screen title="Charging cost">
        <EmptyState
          icon="car"
          title="Add your car first"
          body="The cost depends on your battery size."
          primary={{
            label: 'Add your EV',
            onPress: () => nav.navigate('VehicleSetup'),
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen
      title="Charging cost"
      stack
      footer={
        <PrimaryButton
          label="Find stations"
          icon="search"
          onPress={() => nav.navigate('StationList')}
        />
      }>
      <Text style={styles.lead}>Estimate before you stop</Text>
      {station.data && (
        <Text style={styles.sub}>Using {station.data.name}’s price</Text>
      )}

      <Card>
        <View style={styles.row}>
          <Text style={styles.label}>From</Text>
          <Text style={styles.value}>{from}%</Text>
        </View>
        <PercentSlider
          label="Charge from"
          value={from}
          min={0}
          max={95}
          step={5}
          onChange={setFrom}
        />
        <View style={[styles.row, styles.gap]}>
          <Text style={styles.label}>To</Text>
          <Text style={styles.value}>{target}%</Text>
        </View>
        <PercentSlider
          label="Charge to"
          value={target}
          min={Math.min(100, from + 5)}
          max={100}
          step={5}
          onChange={setTo}
        />
      </Card>

      <Card>
        <View style={styles.row}>
          <View style={styles.flex}>
            <Text style={styles.label}>Price per kWh</Text>
            <Text style={styles.fine}>
              {manualPrice !== null
                ? 'Your estimate'
                : stationPrice !== null
                ? 'From the station'
                : 'A typical price, not from a charger'}
            </Text>
            {manualPrice === null && stationPrice !== null && station.data && (
              <PriceLine station={station.data} vehicle={vehicle} now={now} />
            )}
          </View>
          <Stepper
            label="price per kilowatt hour"
            value={price}
            min={5}
            max={40}
            step={1}
            format={v => formatInr(v)}
            onChange={setManualPrice}
          />
        </View>
      </Card>

      <Card tone="dark">
        <Text style={styles.kicker}>Estimated cost</Text>
        <Text style={styles.total}>≈ {formatInr(calc.inv.totalInr)}</Text>
        <Text style={styles.heroSub}>
          {calc.kwh.toFixed(1)} kWh • ~{formatDuration(calc.minutes)} on a fast
          charger
        </Text>
      </Card>

      <Card>
        <KeyValue label="Energy" value={`${calc.kwh.toFixed(1)} kWh`} />
        <KeyValue label="Charging" value={formatInr(calc.inv.baseInr, true)} />
        <KeyValue label="GST (18%)" value={formatInr(calc.inv.gstInr, true)} />
        <KeyValue
          label="Total"
          value={formatInr(calc.inv.totalInr, true)}
          emphasis
          last
        />
      </Card>
      <Notice
        tone="info"
        title="It’s an estimate"
        body="Your bill uses the operator’s meter and the price at the time. Charging slows after 80%, so the last 20% takes longer."
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  lead: {...type.display, color: colors.ink},
  sub: {...type.body, color: colors.muted, marginTop: -6},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  gap: {marginTop: spacing.md},
  label: {...type.bodyStrong, color: colors.ink},
  value: {...type.h1, color: colors.ink},
  fine: {...type.caption, color: colors.muted},
  kicker: {...type.micro, color: colors.lime, textTransform: 'uppercase'},
  total: {
    fontSize: 40,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -1,
    marginTop: 6,
  },
  heroSub: {...type.body, color: colors.chipText, marginTop: 4},
});
