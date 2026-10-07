import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {CONFIDENCE_LABEL} from '../../domain/rules';
import type {Forecast} from '../../domain/types';
import {useNavigation, useRoute} from '../../navigation/NavigationContext';
import {useServices} from '../../services';
import {colors, radii, spacing, type} from '../../theme';
import {
  AsyncView,
  Card,
  ConfidenceBadge,
  ConfidencePill,
  EmptyState,
  Notice,
  PrimaryButton,
  Screen,
  useNow,
  useResource,
} from '../../ui';

const BAR_H = 120;

/**
 * 33 Availability forecast (Later phase). Always labelled with a confidence and
 * what it is based on; with no history it says so instead of guessing.
 * TODO(integration): operator occupancy history model.
 */
export default function ForecastScreen(): React.JSX.Element {
  const nav = useNavigation();
  const {params} = useRoute<'Forecast'>();
  const now = useNow(30_000);
  const {station: stationService} = useServices();
  const station = useResource(
    () => stationService.get(params.stationId),
    [params.stationId],
  );
  const forecast = useResource(
    () => stationService.forecast(params.stationId),
    [params.stationId],
  );

  return (
    <Screen
      title="Availability forecast"
      stack
      footer={
        <PrimaryButton
          label="Use station"
          icon="check"
          onPress={() =>
            nav.replace('StationDetail', {stationId: params.stationId})
          }
        />
      }>
      <Text style={styles.lead}>Expected availability</Text>
      {station.data && <Text style={styles.sub}>{station.data.name}</Text>}

      <AsyncView
        resource={forecast}
        errorTitle="Couldn’t load the forecast"
        render={f => (
          <>
            <Card>
              <View style={styles.liveRow}>
                <Text style={styles.live}>
                  Live now: {f.freeNow} of {f.total} free
                </Text>
                {station.data && (
                  <ConfidenceBadge
                    feed={station.data.statusFeed}
                    now={now}
                    subject="Status"
                  />
                )}
              </View>
            </Card>
            {f.basis === 'none' ? (
              <EmptyState
                icon="trending-up"
                title="Not enough history yet"
                body="We only forecast when we have past sessions for this charger. Check the live status instead."
                compact
              />
            ) : (
              <Bars forecast={f} />
            )}
            <Notice
              tone="info"
              title={CONFIDENCE_LABEL[f.confidence]}
              body={
                f.basis === 'history'
                  ? 'Based on how busy this charger usually is at this time. A forecast is a guide, not a promise.'
                  : 'There isn’t enough data to forecast. Treat the live status as the source of truth.'
              }
              action={
                <View style={styles.pill}>
                  <ConfidencePill confidence={f.confidence} />
                </View>
              }
            />
          </>
        )}
      />
    </Screen>
  );
}

function Bars({forecast}: {forecast: Forecast}) {
  return (
    <Card>
      <Text style={styles.chartTitle}>
        Chance of a free bay, next 60 minutes
      </Text>
      <View
        style={styles.chart}
        accessible
        accessibilityLabel={`Chance of a free bay over the next hour, between ${Math.round(
          Math.min(...forecast.next60) * 100,
        )} and ${Math.round(Math.max(...forecast.next60) * 100)} percent`}>
        {forecast.next60.map((p, i) => (
          <View key={i} style={styles.col}>
            <View
              style={[
                styles.bar,
                {height: Math.max(8, p * BAR_H)},
                p >= 0.6 ? styles.good : p >= 0.35 ? styles.mid : styles.low,
              ]}
            />
          </View>
        ))}
      </View>
      <View style={styles.axis}>
        <Text style={styles.axisText}>Now</Text>
        <Text style={styles.axisText}>30 min</Text>
        <Text style={styles.axisText}>60 min</Text>
      </View>
      <View style={styles.legend}>
        <Dot color={colors.lime} label="Likely free" />
        <Dot color={colors.amber} label="Maybe" />
        <Dot color={colors.placeholder} label="Unlikely" />
      </View>
    </Card>
  );
}

function Dot({color, label}: {color: string; label: string}) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, {backgroundColor: color}]} />
      <Text style={styles.axisText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  lead: {...type.display, color: colors.ink},
  sub: {...type.body, color: colors.muted, marginTop: -6},
  liveRow: {gap: spacing.sm},
  live: {...type.h1, color: colors.ink},
  chartTitle: {...type.label, color: colors.muted},
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: BAR_H,
    gap: 4,
    marginTop: spacing.lg,
  },
  col: {flex: 1, justifyContent: 'flex-end'},
  bar: {borderRadius: radii.sm},
  good: {backgroundColor: colors.lime},
  mid: {backgroundColor: '#F2C24A'},
  low: {backgroundColor: colors.slateSoft},
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  axisText: {...type.caption, color: colors.muted, fontSize: 11.5},
  legend: {flexDirection: 'row', gap: spacing.lg, marginTop: spacing.md},
  legendItem: {flexDirection: 'row', alignItems: 'center', gap: 6},
  legendDot: {width: 10, height: 10, borderRadius: 5},
  pill: {flexDirection: 'row', marginTop: 6},
});
