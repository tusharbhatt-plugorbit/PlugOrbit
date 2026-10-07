import React, {useMemo} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {billFor} from '../../domain/sessionBill';
import {rankOrganic} from '../../domain/rules';
import {useNearbyStations} from '../../hooks/useNearbyStations';
import {sessionTarget} from '../../app/initialStack';
import {useNavigation} from '../../navigation/NavigationContext';
import {appStore, selectActiveVehicle, useApp} from '../../store/appStore';
import {colors, spacing, type} from '../../theme';
import {formatClock, formatDate, formatInr} from '../../utils/format';
import {
  Card,
  ChargerCard,
  EmptyState,
  ListCard,
  ListRow,
  ListSkeleton,
  Notice,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionTitle,
  TextButton,
  useNow,
} from '../../ui';

/**
 * Charge tab: start a session (scan / enter ID / pick a nearby charger) or
 * pick up the one in progress.
 */
export default function ChargeScreen(): React.JSX.Element {
  const nav = useNavigation();
  const now = useNow(30_000);
  const vehicle = useApp(selectActiveVehicle);
  const session = useApp(s => s.session);
  const reservation = useApp(s => s.reservation);
  const queue = useApp(s => s.queue);
  const history = useApp(s => s.history);
  const favourites = useApp(s => s.favouriteStationIds);
  const {phase, stations, notice, refresh} = useNearbyStations(vehicle);

  const best = useMemo(
    () => rankOrganic(stations, vehicle).slice(0, 3),
    [stations, vehicle],
  );

  const resume = () => {
    const target = sessionTarget(appStore.get());
    if (target) {
      nav.navigate(target.name as 'ActiveSession');
    }
  };

  return (
    <Screen title="Charge" hideBack stack>
      {session ? (
        <Card tone="dark">
          <Text style={styles.kicker}>
            {session.status === 'active'
              ? 'Charging now'
              : session.status === 'payment_failed'
              ? 'Payment needs attention'
              : 'Session ended'}
          </Text>
          <Text style={styles.heroTitle}>{session.stationName}</Text>
          <Text style={styles.heroSub}>
            {session.status === 'active'
              ? `${Math.round(billFor(session, now).metrics.socPercent)}% • ${
                  session.connectorLabel
                }`
              : `${formatInr(
                  billFor(session, now).invoice.totalInr,
                  true,
                )} to pay`}
          </Text>
          <View style={styles.heroBtn}>
            <PrimaryButton
              label={
                session.status === 'active' ? 'Resume session' : 'Settle up'
              }
              variant="lime"
              icon="zap"
              onPress={resume}
            />
          </View>
        </Card>
      ) : (
        <Card tone="dark">
          <Text style={styles.kicker}>Ready to charge</Text>
          <Text style={styles.heroTitle}>Scan the QR on the charger</Text>
          <Text style={styles.heroSub}>
            Partner chargers start in seconds. Others open the operator’s own
            app.
          </Text>
          <View style={styles.heroBtn}>
            <PrimaryButton
              label="Scan charger QR"
              variant="lime"
              icon="scan-line"
              onPress={() => nav.navigate('ScanQr')}
            />
          </View>
          <View style={styles.center}>
            <TextButton
              label="Enter charger ID instead"
              tone="onDark"
              onPress={() => nav.navigate('ScanQr')}
            />
          </View>
        </Card>
      )}

      {(reservation || queue) && (
        <ListCard>
          {reservation && (
            <ListRow
              icon="calendar-check"
              iconTone="lime"
              title={`Reserved: ${reservation.stationName}`}
              subtitle={`Arrive by ${formatClock(reservation.arrivalAt)} • ${
                reservation.holdMinutes
              }-min hold`}
              onPress={() =>
                nav.navigate('Reservation', {stationId: reservation.stationId})
              }
              last={!queue}
            />
          )}
          {queue && (
            <ListRow
              icon="users"
              iconTone="info"
              title={`#${queue.position} in queue at ${queue.stationName}`}
              subtitle="Tap for your wait range and backup"
              onPress={() =>
                nav.navigate('Queue', {stationId: queue.stationId})
              }
              last
            />
          )}
        </ListCard>
      )}

      <SectionTitle
        title="Best chargers near you"
        action={
          <TextButton
            label="See all"
            onPress={() => nav.navigate('StationList')}
          />
        }
      />
      {phase !== 'ready' ? (
        <ListSkeleton count={2} />
      ) : best.length === 0 ? (
        <EmptyState
          icon="plug-zap"
          title={
            vehicle
              ? 'No compatible chargers nearby'
              : 'Add your car to see chargers'
          }
          body={
            vehicle
              ? 'Try searching a wider area, or include chargers your car can’t use in Filters.'
              : 'We only show chargers that fit your car.'
          }
          primary={{
            label: vehicle ? 'Open filters' : 'Add your EV',
            onPress: () => nav.navigate(vehicle ? 'Filters' : 'VehicleSetup'),
          }}
          compact
        />
      ) : (
        <View style={styles.list}>
          {notice && (
            <Notice
              tone="warn"
              title={notice.message}
              action={<TextButton label="Retry" onPress={refresh} />}
            />
          )}
          {best.map((s, i) => (
            <ChargerCard
              key={s.id}
              station={s}
              vehicle={vehicle}
              now={now}
              recommended={i === 0}
              favourite={favourites.includes(s.id)}
              onPress={() => nav.navigate('StationDetail', {stationId: s.id})}
            />
          ))}
        </View>
      )}

      {history.length > 0 && (
        <>
          <SectionTitle
            title="Recent"
            action={
              <TextButton
                label="Activity"
                onPress={() => nav.switchTab('Activity')}
              />
            }
          />
          <ListCard>
            {history.slice(0, 2).map((h, i, arr) => (
              <ListRow
                key={h.id}
                icon="receipt"
                title={h.stationName}
                subtitle={`${formatDate(h.startedAt)} • ${h.energyKwh.toFixed(
                  1,
                )} kWh • ${formatInr(h.costInr)}`}
                onPress={() => nav.navigate('SessionDetail', {sessionId: h.id})}
                last={i === arr.length - 1}
              />
            ))}
          </ListCard>
        </>
      )}

      <Notice
        tone="info"
        title="Two kinds of chargers"
        body="Partner chargers can be started and paid in PlugOrbit. Chargers marked “Operator app” are run by other networks; we guide you, they start and bill."
      />
      <View style={styles.center}>
        <SecondaryButton
          label="Find a charger on the map"
          icon="map"
          compact
          onPress={() => nav.switchTab('Home')}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  kicker: {...type.micro, color: colors.lime, textTransform: 'uppercase'},
  heroTitle: {...type.h1, color: '#FFFFFF', marginTop: 6},
  heroSub: {...type.body, color: colors.chipText, marginTop: 6},
  heroBtn: {marginTop: spacing.lg},
  center: {alignItems: 'center', marginTop: spacing.sm},
  list: {gap: spacing.md},
});
