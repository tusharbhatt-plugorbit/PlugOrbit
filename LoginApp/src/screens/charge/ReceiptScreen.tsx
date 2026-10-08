import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {invoiceFor} from '../../domain/charging';
import {useNavigation, useRoute} from '../../navigation/NavigationContext';
import {useApp} from '../../store/appStore';
import {colors, radii, spacing, type} from '../../theme';
import {formatDateTime, formatDuration, formatInr} from '../../utils/format';
import {
  Card,
  EmptyState,
  Icon,
  KeyValue,
  Notice,
  PrimaryButton,
  Screen,
  SecondaryButton,
  showToast,
} from '../../ui';

/** 17 Receipt. Read-only: everything comes from the settled session in history. */
export default function ReceiptScreen(): React.JSX.Element {
  const nav = useNavigation();
  const {params} = useRoute<'Receipt'>();
  const summary = useApp(s => s.history.find(h => h.id === params.sessionId));
  const rated = useApp(s => s.feedbackDone.includes(params.sessionId));
  // A trip that was waiting for this charge is back on the road.
  const trip = useApp(s => s.activeTrip);
  const resumed = trip !== null && trip.phase === 'driving';

  if (!summary) {
    return (
      <Screen title="Receipt" hideBack>
        <EmptyState
          icon="receipt"
          title="Receipt not found"
          body="We couldn’t find this session. It may have been erased from your history."
          primary={{
            label: 'Go home',
            icon: 'house',
            onPress: () => nav.reset('Home'),
          }}
        />
      </Screen>
    );
  }

  const invoice = invoiceFor(summary.energyKwh, summary.pricePerKwh);
  // The stored total is authoritative (it can include operator rounding).
  const total = summary.costInr;

  return (
    <Screen
      title="Receipt"
      hideBack
      stack
      footer={
        <>
          {resumed && (
            <PrimaryButton
              label="Continue trip"
              icon="navigation"
              onPress={() => nav.reset('SmartDrive')}
              testID="continue-trip"
            />
          )}
          {!rated &&
            (resumed ? (
              <SecondaryButton
                label="Rate this stop"
                icon="star"
                onPress={() =>
                  nav.navigate('Feedback', {sessionId: summary.id})
                }
              />
            ) : (
              <PrimaryButton
                label="Rate this stop"
                icon="star"
                onPress={() =>
                  nav.navigate('Feedback', {sessionId: summary.id})
                }
              />
            ))}
          <SecondaryButton
            label="Done"
            icon="check"
            onPress={() => nav.reset('Home')}
          />
        </>
      }>
      <View style={styles.hero}>
        <View style={styles.check}>
          <Icon name="check" size={34} color={colors.ink} strokeWidth={3} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          Payment successful
        </Text>
        <Text style={styles.total}>{formatInr(total, true)}</Text>
        <Text style={styles.sub}>
          {summary.stationName} • {formatDateTime(summary.startedAt)}
        </Text>
      </View>

      {resumed && trip && (
        <Notice
          tone="lime"
          title="You’re ready to continue."
          body={`Battery ${summary.endSoc}%. Your trip to ${trip.destination} is back on track.`}
        />
      )}

      <Card>
        <KeyValue label="Session" value={summary.id} />
        <KeyValue
          label="Energy"
          value={`${summary.energyKwh.toFixed(1)} kWh`}
        />
        <KeyValue
          label="Duration"
          value={formatDuration(summary.durationMin)}
        />
        <KeyValue
          label="Battery"
          value={`${summary.startSoc}% → ${summary.endSoc}%`}
        />
        <KeyValue
          label="Connector"
          value={`${summary.connectorLabel} • ${summary.powerKw} kW`}
          last
        />
      </Card>

      <Card>
        <KeyValue
          label={`${invoice.energyKwh.toFixed(2)} kWh × ${formatInr(
            invoice.pricePerKwh,
            invoice.pricePerKwh % 1 !== 0,
          )}`}
          value={formatInr(invoice.baseInr, true)}
        />
        <KeyValue label="GST (18%)" value={formatInr(invoice.gstInr, true)} />
        <KeyValue label="Total paid" value={formatInr(total, true)} emphasis />
        <KeyValue label="Receipt no." value={summary.receiptNo} last />
      </Card>

      <View style={styles.actions}>
        <SecondaryButton
          label="Download GST receipt"
          icon="file-down"
          // TODO(integration): generate the GST invoice PDF on the backend.
          onPress={() =>
            showToast('GST receipt saved to your files.', 'success')
          }
        />
        <SecondaryButton
          label="View in Activity"
          icon="history"
          onPress={() => nav.navigate('SessionDetail', {sessionId: summary.id})}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {alignItems: 'center', paddingVertical: spacing.lg, gap: 6},
  check: {
    width: 72,
    height: 72,
    borderRadius: radii.xl,
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: {...type.h1, color: colors.ink},
  total: {
    fontSize: 40,
    fontWeight: '800',
    color: colors.ink,
    letterSpacing: -1,
  },
  sub: {...type.caption, color: colors.muted},
  actions: {gap: spacing.sm, marginTop: spacing.sm},
});
