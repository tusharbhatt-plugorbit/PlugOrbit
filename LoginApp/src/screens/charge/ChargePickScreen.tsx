import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {
  emptyRecommendationCopy,
  Recommendation,
  ScoredCharger,
} from '../../domain/recommendation';
import {useUserOrigin} from '../../hooks/useUserOrigin';
import {useNavigation, useRoute} from '../../navigation/NavigationContext';
import {useServices} from '../../services';
import {selectActiveVehicle, useApp} from '../../store/appStore';
import {chooseCharger} from '../../store/tripActions';
import {colors, spacing, type} from '../../theme';
import {formatInr} from '../../utils/format';
import {
  AsyncView,
  Card,
  CardSkeleton,
  ChargerPickCard,
  EmptyState,
  ListCard,
  ListRow,
  Notice,
  Pill,
  Screen,
  StatusLine,
  TextButton,
  useNow,
  useResource,
} from '../../ui';
import {vehicleName} from '../../ui/session';

/**
 * Charge nearby / Battery critical. The driver doesn't pick from a list: we
 * pick, explain why, and keep a backup ready. Battery critical changes the
 * priorities (reach it, trust it, find a free bay, keep it close, then speed;
 * price never comes first) and says so in plain words.
 */
export default function ChargePickScreen(): React.JSX.Element {
  const nav = useNavigation();
  const {params} = useRoute<'ChargePick'>();
  const critical = params?.mode === 'critical';
  const now = useNow(15_000);
  const {recommendation} = useServices();
  const vehicle = useApp(selectActiveVehicle);
  const battery = useApp(s => s.battery);
  const {origin, known, ready, demoArea} = useUserOrigin();
  const title = critical ? 'Battery critical' : 'Charge nearby';

  const res = useResource(
    () =>
      recommendation.recommend({
        intent: critical ? 'battery_critical' : 'charge_nearby',
        origin,
      }),
    [
      critical,
      origin.latitude,
      origin.longitude,
      vehicle?.id ?? null,
      battery?.percent ?? null,
    ],
    {enabled: ready && vehicle !== null && battery !== null},
  );

  if (!vehicle) {
    return (
      <Screen title={title}>
        <EmptyState
          icon="car"
          title="Add your car first"
          body="We pick chargers that fit your car and tell you how long it will take."
          primary={{
            label: 'Add your EV',
            icon: 'plus',
            onPress: () => nav.navigate('VehicleSetup'),
          }}
        />
      </Screen>
    );
  }
  if (!battery) {
    return (
      <Screen title={title}>
        <EmptyState
          icon="battery-charging"
          title="Tell us your battery level"
          body="Then we can tell which chargers you can reach and how much to charge."
          primary={{
            label: 'Set battery',
            icon: 'battery-charging',
            onPress: () => nav.navigate('ManualSoc'),
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen title={title} stack>
      {!known && ready && (
        <Notice
          tone="warn"
          title={
            demoArea ? 'Showing chargers near New Delhi' : 'Location is off'
          }
          body={
            demoArea
              ? 'You’re far from the demo chargers, so distances are measured from New Delhi.'
              : 'We couldn’t find where you are, so distances are measured from New Delhi.'
          }
          action={
            <TextButton
              label="Fix location on the map"
              onPress={() => nav.navigate('Map')}
            />
          }
        />
      )}
      <AsyncView
        resource={res}
        errorTitle="Couldn’t check the chargers"
        errorBody="We couldn’t reach the charger network. Check your connection and try again."
        loading={<CardSkeleton lines={6} />}
        isEmpty={r => r.status !== 'ok'}
        empty={
          <NoPick rec={res.data} critical={critical} onRetry={res.reload} />
        }
        render={rec => (
          <Picked
            rec={rec}
            critical={critical}
            vehicleLabel={vehicleName(vehicle)}
            now={now}
          />
        )}
      />
    </Screen>
  );
}

function Picked({
  rec,
  critical,
  vehicleLabel,
  now,
}: {
  rec: Recommendation;
  critical: boolean;
  vehicleLabel: string;
  now: number;
}) {
  const nav = useNavigation();
  const pick = rec.primary!;
  const hidden = rec.excluded.filter(
    e => e.reason === 'incompatible' || e.reason === 'unconfirmed_connectors',
  ).length;

  const use = () => {
    chooseCharger(
      pick.station.id,
      pick.connector.id,
      rec.backup?.station.id ?? null,
    );
    nav.navigate('Navigation', {stationId: pick.station.id});
  };

  return (
    <>
      <Card tone={critical ? 'warn' : 'default'}>
        <StatusLine
          tone={critical ? 'critical' : 'good'}
          headline={
            critical
              ? 'Battery is low. We’ve found the safest charging option.'
              : `Here’s the best charger for your ${vehicleLabel} right now.`
          }
          detail={
            critical
              ? pick.reasons[0] ?? 'This is the safest charger within reach.'
              : rec.backup
              ? 'We’ve checked it for your car and picked a backup in case it fills up.'
              : 'We’ve checked it for your car. No backup is close enough, so we’ll keep a close eye on it.'
          }
        />
      </Card>

      <ChargerPickCard
        pick={pick}
        backup={rec.backup ? {name: rec.backup.station.name} : null}
        backupExtraMin={rec.backupExtraMin}
        now={now}
        kicker={critical ? 'Safest option' : 'PlugOrbit pick'}
        impactTitle="Total time"
        reasons={critical ? pick.reasons.slice(1) : undefined}
        onUse={use}
        onDetails={() =>
          nav.navigate('StationDetail', {stationId: pick.station.id})
        }
        onBackup={
          rec.backup
            ? () =>
                nav.navigate('StationDetail', {
                  stationId: rec.backup!.station.id,
                })
            : undefined
        }
        testID="charge-pick"
      />

      {!critical && rec.comparison && (
        <>
          <Text style={styles.section}>How the options compare</Text>
          <ListCard>
            {rec.comparison.map((row, i, arr) => (
              <ListRow
                key={row.kind}
                icon={
                  row.kind === 'fastest'
                    ? 'timer'
                    : row.kind === 'cheapest'
                    ? 'indian-rupee'
                    : 'sparkles'
                }
                iconTone={row.kind === 'pick' ? 'lime' : 'default'}
                title={
                  row.kind === 'fastest'
                    ? 'Fastest'
                    : row.kind === 'cheapest'
                    ? 'Cheapest'
                    : 'PlugOrbit pick'
                }
                subtitle={`${row.stationName} • ${row.impactText}`}
                right={
                  <Text style={styles.price}>
                    {row.totalInr === null
                      ? 'Price n/a'
                      : formatInr(row.totalInr)}
                  </Text>
                }
                onPress={() =>
                  nav.navigate('StationDetail', {stationId: row.stationId})
                }
                last={i === arr.length - 1}
              />
            ))}
          </ListCard>
        </>
      )}

      {rec.alternatives.length > 0 && (
        <>
          <Text style={styles.section}>Other options</Text>
          <ListCard>
            {rec.alternatives.map((alt, i, arr) => (
              <AltRow
                key={alt.station.id}
                alt={alt}
                last={i === arr.length - 1}
              />
            ))}
          </ListCard>
        </>
      )}

      {hidden > 0 && (
        <Notice
          tone="info"
          title={`${hidden} ${hidden === 1 ? 'charger' : 'chargers'} left out`}
          body="They don’t fit your car, or we can’t confirm their plug type."
          action={
            <TextButton
              label="See everything nearby"
              onPress={() => nav.navigate('StationList')}
            />
          }
        />
      )}

      <View style={styles.links}>
        {critical ? (
          <TextButton
            label="Need help? Roadside assistance"
            icon="life-buoy"
            onPress={() => nav.navigate('Roadside')}
          />
        ) : (
          <TextButton
            label="See chargers on the map"
            icon="map"
            onPress={() => nav.navigate('Map')}
          />
        )}
      </View>
    </>
  );
}

function AltRow({alt, last}: {alt: ScoredCharger; last: boolean}) {
  const nav = useNavigation();
  return (
    <ListRow
      icon="plug-zap"
      title={alt.station.name}
      subtitle={`~${alt.charge.minutes} min to charge • ${
        alt.cost.totalInr === null ? 'price n/a' : formatInr(alt.cost.totalInr)
      }`}
      right={
        <Pill
          label={alt.confidence.label.replace(' Charge Confidence', '')}
          tone={
            alt.confidence.level === 'high'
              ? 'lime'
              : alt.confidence.level === 'medium'
              ? 'info'
              : 'slate'
          }
        />
      }
      onPress={() => nav.navigate('StationDetail', {stationId: alt.station.id})}
      last={last}
    />
  );
}

/** Nothing usable: say exactly why, and what the driver can do next. */
function NoPick({
  rec,
  critical,
  onRetry,
}: {
  rec: Recommendation | null;
  critical: boolean;
  onRetry: () => void;
}) {
  const nav = useNavigation();
  const status = rec?.status ?? 'no_candidates';
  const copy = emptyRecommendationCopy(status);
  if (
    status === 'none_reachable' ||
    (critical && status !== 'none_compatible')
  ) {
    return (
      <EmptyState
        icon="battery-warning"
        title={copy.title}
        body={copy.body}
        primary={{
          label: 'Get roadside help',
          icon: 'life-buoy',
          onPress: () => nav.navigate('Roadside'),
        }}
        secondary={{label: 'Try again', onPress: onRetry}}
      />
    );
  }
  if (status === 'none_compatible') {
    return (
      <EmptyState
        icon="plug"
        title={copy.title}
        body={copy.body}
        primary={{
          label: 'Check my car’s plugs',
          icon: 'car',
          onPress: () => nav.navigate('Vehicles'),
        }}
        secondary={{
          label: 'Show every charger',
          onPress: () => nav.navigate('StationList'),
        }}
      />
    );
  }
  return (
    <EmptyState
      icon="plug-zap"
      title={copy.title}
      body={copy.body}
      primary={{label: 'Try again', icon: 'refresh-cw', onPress: onRetry}}
      secondary={{label: 'Open the map', onPress: () => nav.navigate('Map')}}
    />
  );
}

const styles = StyleSheet.create({
  section: {...type.heading, color: colors.ink, marginTop: spacing.sm},
  price: {...type.bodyStrong, color: colors.ink},
  links: {alignItems: 'center', marginTop: spacing.sm},
});
