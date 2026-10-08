import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {stopCostLabel, tripCost} from '../../domain/routeCost';
import {priceAgeLabel} from '../../domain/trust';
import type {Route} from '../../domain/types';
import {useNavigation} from '../../navigation/NavigationContext';
import {useApp} from '../../store/appStore';
import {colors, radii, spacing, type} from '../../theme';
import {
  Card,
  EmptyState,
  KeyValue,
  PrimaryButton,
  Screen,
  useNow,
} from '../../ui';

type Leg = {
  key: string;
  label: string;
  /** Battery on arrival (or at the start). */
  arrive: number;
  /** Charge-to level when this leg is a stop. */
  chargeTo?: number;
  note: string;
  /** How old the price behind a stop's cost is, and who vouches for it. */
  priceNote?: string;
};

function legsFor(route: Route, now: number): Leg[] {
  const out: Leg[] = [
    {
      key: 'start',
      label: route.fromLabel,
      arrive: route.startSoc,
      note: 'Start',
    },
  ];
  route.stops.forEach((s, i) => {
    out.push({
      key: s.station.id,
      label: s.station.name,
      arrive: s.arriveSoc,
      chargeTo: s.chargeToSoc,
      note: `Stop ${i + 1} • ~${s.chargeMin} min • ${stopCostLabel(s.costInr)}`,
      priceNote:
        s.costInr === null
          ? undefined
          : priceAgeLabel(s.station.priceFeed, now),
    });
  });
  out.push({
    key: 'end',
    label: route.toLabel,
    arrive: route.arriveSoc,
    note: 'Arrive',
  });
  return out;
}

/** 28 Energy planner: the battery at every point of the trip, against your reserve. */
export default function EnergyPlannerScreen(): React.JSX.Element {
  const nav = useNavigation();
  const route = useApp(s => s.activeRoute);
  const now = useNow(30_000);

  if (!route) {
    return (
      <Screen title="Energy planner">
        <EmptyState
          icon="battery-charging"
          title="Plan a trip first"
          body="The energy plan shows your battery at each stop, so you can see how much room you have."
          primary={{
            label: 'Plan a trip',
            icon: 'route',
            onPress: () => nav.replace('RoutePlanner'),
          }}
        />
      </Screen>
    );
  }

  const legs = legsFor(route, now);
  const lowest = Math.min(...legs.map(l => l.arrive));
  const totalCost = tripCost(route.stops);

  return (
    <Screen
      title="Energy planner"
      stack
      footer={
        <PrimaryButton
          large
          label="Use this plan"
          icon="check"
          onPress={() => nav.replace('RouteResult')}
          style={styles.cta}
        />
      }>
      <Text style={styles.lead}>
        {route.fromLabel} → {route.toLabel}
      </Text>

      <Card>
        {legs.map((leg, i) => (
          <View
            key={leg.key}
            style={[styles.leg, i < legs.length - 1 && styles.legGap]}>
            <View style={styles.legHead}>
              <Text style={styles.legLabel} numberOfLines={1}>
                {leg.label}
              </Text>
              <Text style={styles.legSoc}>
                {leg.chargeTo !== undefined
                  ? `${leg.arrive}% → ${leg.chargeTo}%`
                  : `${leg.arrive}%`}
              </Text>
            </View>
            <View
              style={styles.track}
              accessible
              accessibilityLabel={`${leg.label}: battery ${leg.arrive} percent${
                leg.chargeTo !== undefined
                  ? `, charge to ${leg.chargeTo} percent`
                  : ''
              }`}>
              <View style={[styles.arrive, {width: `${leg.arrive}%`}]} />
              {leg.chargeTo !== undefined && (
                <View
                  style={[
                    styles.charge,
                    {
                      left: `${leg.arrive}%`,
                      width: `${leg.chargeTo - leg.arrive}%`,
                    },
                  ]}
                />
              )}
              <View
                style={[styles.reserve, {left: `${route.safetyReservePct}%`}]}
              />
            </View>
            <Text style={styles.note}>{leg.note}</Text>
            {leg.priceNote ? (
              <Text style={styles.priceNote}>{leg.priceNote}</Text>
            ) : null}
          </View>
        ))}
        <View style={styles.legend}>
          <View style={[styles.swatch, {backgroundColor: colors.bg}]} />
          <Text style={styles.note}>Battery on arrival</Text>
          <View style={[styles.swatch, {backgroundColor: colors.lime}]} />
          <Text style={styles.note}>Charged</Text>
          <View style={[styles.swatch, styles.swatchReserve]} />
          <Text style={styles.note}>{route.safetyReservePct}% reserve</Text>
        </View>
      </Card>

      <Card>
        <KeyValue label="Lowest point" value={`${lowest}%`} emphasis />
        <KeyValue label="Safety reserve" value={`${route.safetyReservePct}%`} />
        <KeyValue label="Charging cost" value={totalCost.label} />
        <KeyValue label="Stops" value={String(route.stops.length)} last />
      </Card>
      <Text style={styles.fine}>
        Estimates use your car’s typical highway consumption. Speed, load and
        weather change it, so we keep a reserve. Costs use each stop’s last
        published price.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: {...type.h1, color: colors.ink},
  leg: {},
  legGap: {marginBottom: spacing.lg},
  legHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  legLabel: {...type.bodyStrong, color: colors.ink, flex: 1},
  legSoc: {...type.heading, color: colors.ink},
  track: {
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.slateSoft,
    marginTop: spacing.sm,
    overflow: 'visible',
  },
  arrive: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.bg,
    borderRadius: 6,
  },
  charge: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: colors.lime,
  },
  reserve: {
    position: 'absolute',
    top: -3,
    bottom: -3,
    width: 3,
    borderRadius: 2,
    backgroundColor: colors.danger,
  },
  note: {...type.caption, color: colors.muted, marginTop: 4},
  priceNote: {...type.caption, color: colors.muted, fontSize: 12},
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    marginTop: spacing.lg,
  },
  swatchReserve: {backgroundColor: colors.danger, width: 3},
  swatch: {width: 12, height: 12, borderRadius: radii.sm / 2},
  fine: {...type.caption, color: colors.muted},
  cta: {marginVertical: spacing.xs},
});
