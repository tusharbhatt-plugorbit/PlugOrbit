import React, {useMemo, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {sessionTarget} from '../../app/initialStack';
import {billFor} from '../../domain/sessionBill';
import {useNavigation, useRoute} from '../../navigation/NavigationContext';
import {appStore, useApp} from '../../store/appStore';
import {colors, radii, spacing, type} from '../../theme';
import {formatInr} from '../../utils/format';
import {
  Card,
  EmptyState,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SegmentedControl,
  SessionRow,
  SupportTicketCard,
  TextButton,
  useNow,
} from '../../ui';

type Segment = 'sessions' | 'tickets';
const SEGMENTS: ReadonlyArray<{value: Segment; label: string}> = [
  {value: 'sessions', label: 'Charging'},
  {value: 'tickets', label: 'Support tickets'},
];

/** 18 Activity: charging history and receipts, plus support tickets. */
export default function ActivityScreen(): React.JSX.Element {
  const nav = useNavigation();
  const {params} = useRoute<'Activity'>();
  const now = useNow(30_000);
  const history = useApp(s => s.history);
  const tickets = useApp(s => s.tickets);
  const session = useApp(s => s.session);
  const [segment, setSegment] = useState<Segment>(
    params?.segment ?? 'sessions',
  );

  const totals = useMemo(
    () => ({
      kwh: history.reduce((m, h) => m + h.energyKwh, 0),
      rupees: history.reduce((m, h) => m + h.costInr, 0),
    }),
    [history],
  );

  const resume = () => {
    const target = sessionTarget(appStore.get());
    if (target) {
      nav.navigate(target.name as 'ActiveSession');
    }
  };

  return (
    <Screen title="Activity" hideBack stack>
      <SegmentedControl
        options={SEGMENTS}
        value={segment}
        onChange={setSegment}
      />

      {segment === 'sessions' ? (
        <>
          {session && (
            <Card tone="dark">
              <Text style={styles.kicker}>
                {session.status === 'active'
                  ? 'In progress'
                  : 'Needs attention'}
              </Text>
              <Text style={styles.heroTitle}>{session.stationName}</Text>
              <Text style={styles.heroSub}>
                {session.status === 'active'
                  ? `${Math.round(
                      billFor(session, now).metrics.socPercent,
                    )}% • ${session.connectorLabel}`
                  : `${formatInr(
                      billFor(session, now).invoice.totalInr,
                      true,
                    )} to pay`}
              </Text>
              <View style={styles.heroBtn}>
                <PrimaryButton
                  label={
                    session.status === 'active' ? 'Open session' : 'Settle up'
                  }
                  variant="lime"
                  compact
                  onPress={resume}
                />
              </View>
            </Card>
          )}

          {history.length > 0 && (
            <View style={styles.stats}>
              <Stat label="Energy" value={`${totals.kwh.toFixed(0)} kWh`} />
              <Stat label="Spent" value={formatInr(totals.rupees)} />
              <Stat label="Sessions" value={String(history.length)} />
            </View>
          )}

          {history.length === 0 && !session ? (
            <EmptyState
              icon="history"
              title="No charging yet"
              body="Your sessions and receipts appear here after your first charge."
              primary={{
                label: 'Find a charger',
                icon: 'search',
                onPress: () => nav.switchTab('Home'),
              }}
            />
          ) : (
            history.map(h => (
              <SessionRow
                key={h.id}
                session={h}
                onPress={() => nav.navigate('SessionDetail', {sessionId: h.id})}
              />
            ))
          )}
        </>
      ) : (
        <>
          {tickets.length === 0 ? (
            <EmptyState
              icon="message-circle"
              title="No support tickets"
              body="If something goes wrong with a charge or a payment, we’ll track it here."
              primary={{
                label: 'Get help',
                icon: 'life-buoy',
                onPress: () => nav.navigate('Support'),
              }}
            />
          ) : (
            <>
              {tickets.map(t => (
                <SupportTicketCard
                  key={t.id}
                  ticket={t}
                  onPress={() => nav.navigate('TicketDetail', {ticketId: t.id})}
                />
              ))}
              <View style={styles.center}>
                <SecondaryButton
                  label="New ticket"
                  icon="plus"
                  compact
                  onPress={() => nav.navigate('Support')}
                />
              </View>
            </>
          )}
        </>
      )}

      <View style={styles.center}>
        <TextButton
          label="Notifications"
          icon="bell"
          tone="muted"
          onPress={() => nav.navigate('Notifications')}
        />
      </View>
    </Screen>
  );
}

function Stat({label, value}: {label: string; value: string}) {
  return (
    <View
      style={styles.stat}
      accessible
      accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  kicker: {...type.micro, color: colors.lime, textTransform: 'uppercase'},
  heroTitle: {...type.h1, color: '#FFFFFF', marginTop: 6},
  heroSub: {...type.body, color: colors.chipText, marginTop: 4},
  heroBtn: {marginTop: spacing.md, alignItems: 'flex-start'},
  stats: {flexDirection: 'row', gap: spacing.sm},
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  statValue: {...type.heading, color: colors.ink},
  statLabel: {...type.caption, color: colors.muted, marginTop: 2},
  center: {alignItems: 'center'},
});
