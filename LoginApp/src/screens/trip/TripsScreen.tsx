import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {timeAgo} from '../../domain/trust';
import {useNavigation} from '../../navigation/NavigationContext';
import {useApp} from '../../store/appStore';
import {clearRoute} from '../../store/tripActions';
import {colors, elevation, radii, spacing, type} from '../../theme';
import {formatClock} from '../../utils/format';
import {
  Card,
  Icon,
  ListCard,
  ListRow,
  Pill,
  RouteSummary,
  Screen,
  SecondaryButton,
  SectionTitle,
  TextButton,
  PrimaryButton,
  useNow,
} from '../../ui';

/** Trips tab: planning, saved routes, energy plans, reservations, multi-stop. */
export default function TripsScreen(): React.JSX.Element {
  const nav = useNavigation();
  const now = useNow(30_000);
  const route = useApp(s => s.activeRoute);
  const saved = useApp(s => s.savedRoutes);
  const reservation = useApp(s => s.reservation);
  const queue = useApp(s => s.queue);

  return (
    <Screen title="Trips" hideBack stack>
      <Card tone="dark">
        <Text style={styles.kicker}>Plan a trip</Text>
        <Text style={styles.heroTitle}>Charge only when needed</Text>
        <Pressable
          onPress={() => nav.navigate('RoutePlanner')}
          accessibilityRole="button"
          accessibilityLabel="Where to?"
          style={({pressed}) => [
            styles.search,
            elevation(1),
            pressed && {opacity: 0.9},
          ]}>
          <Icon name="search" size={18} color={colors.muted} />
          <Text style={styles.searchText}>Where to?</Text>
        </Pressable>
      </Card>

      {route ? (
        <>
          <SectionTitle
            title="Current plan"
            action={
              <TextButton label="Clear" tone="muted" onPress={clearRoute} />
            }
          />
          <RouteSummary
            route={route}
            cachedLabel={`Planned ${timeAgo(route.computedAt, now)}.`}
          />
          <PrimaryButton
            label="Open route"
            icon="route"
            onPress={() => nav.navigate('RouteResult')}
          />
        </>
      ) : null}

      {(reservation || queue) && (
        <>
          <SectionTitle title="Reservations & queue" />
          <ListCard>
            {reservation && (
              <ListRow
                icon="calendar-check"
                iconTone="lime"
                title={reservation.stationName}
                subtitle={`Reserved for ${formatClock(reservation.arrivalAt)}`}
                onPress={() =>
                  nav.navigate('Reservation', {
                    stationId: reservation.stationId,
                  })
                }
                last={!queue}
              />
            )}
            {queue && (
              <ListRow
                icon="users"
                iconTone="info"
                title={`#${queue.position} in queue`}
                subtitle={queue.stationName}
                onPress={() =>
                  nav.navigate('Queue', {stationId: queue.stationId})
                }
                last
              />
            )}
          </ListCard>
        </>
      )}

      <SectionTitle
        title="Saved routes"
        action={
          <TextButton label="See all" onPress={() => nav.navigate('Saved')} />
        }
      />
      {saved.length === 0 ? (
        <Card>
          <Text style={styles.empty}>
            Routes you save show up here for one-tap planning.
          </Text>
        </Card>
      ) : (
        <ListCard>
          {saved.slice(0, 3).map((r, i, arr) => (
            <ListRow
              key={r.id}
              icon="route"
              title={`${r.fromLabel} → ${r.toLabel}`}
              subtitle={
                r.strategy === 'fastest'
                  ? 'Fastest'
                  : r.strategy === 'cheapest'
                  ? 'Cheapest'
                  : 'Most reliable'
              }
              right={<Pill label="Plan" tone="lime" />}
              onPress={() =>
                nav.navigate('RoutePlanner', {
                  fromLabel: r.fromLabel,
                  toLabel: r.toLabel,
                })
              }
              last={i === arr.length - 1}
            />
          ))}
        </ListCard>
      )}

      <SectionTitle title="Trip tools" />
      <ListCard>
        <ListRow
          icon="battery-charging"
          iconTone="lime"
          title="Energy planner"
          subtitle="See your battery at every stop"
          onPress={() => nav.navigate('EnergyPlanner')}
        />
        <ListRow
          icon="map-pinned"
          title="Multi-stop trip"
          subtitle="Plan the full day with charging in between"
          onPress={() => nav.navigate('MultiStop')}
        />
        <ListRow
          icon="wifi-off"
          iconTone="warn"
          title="Offline trip mode"
          subtitle="Your route and chargers without signal"
          onPress={() => nav.navigate('OfflineMode')}
        />
        <ListRow
          icon="shield-check"
          iconTone="info"
          title="Trip preferences"
          subtitle="Safety reserve, strategy, parking"
          onPress={() => nav.navigate('TripPreferences')}
          last
        />
      </ListCard>
      <View style={styles.center}>
        <SecondaryButton
          label="Cost calculator"
          icon="indian-rupee"
          compact
          onPress={() => nav.navigate('CostCalculator')}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  kicker: {...type.micro, color: colors.lime, textTransform: 'uppercase'},
  heroTitle: {...type.h1, color: '#FFFFFF', marginTop: 6},
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 52,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    marginTop: spacing.lg,
  },
  searchText: {...type.body, color: colors.muted},
  empty: {...type.body, color: colors.muted},
  center: {alignItems: 'center'},
});
