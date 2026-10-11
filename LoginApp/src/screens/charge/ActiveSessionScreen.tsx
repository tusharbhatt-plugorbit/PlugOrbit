import React, {useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {billFor} from '../../domain/sessionBill';
import {describeError} from '../../domain/describeError';
import {useIsFocused, useNavigation} from '../../navigation/NavigationContext';
import {useServices} from '../../services';
import {useApp} from '../../store/appStore';
import {colors, spacing, type} from '../../theme';
import {formatDuration, formatInr} from '../../utils/format';
import {
  Card,
  EmptyState,
  KeyValue,
  Notice,
  Pill,
  PrimaryButton,
  Screen,
  SessionMetricCard,
  showToast,
  TextButton,
  useNow,
} from '../../ui';
import {ConfirmActionSheet} from '../../ui/ConfirmActionSheet';
import {SessionRing} from '../../ui/SessionRing';

/**
 * 14 Charging. Every number is a pure function of the stored session and the
 * clock, so reopening the app mid-charge just picks up where it was.
 * TODO(integration): charger CMS meter values replace the simulated curve.
 */
export default function ActiveSessionScreen(): React.JSX.Element {
  const nav = useNavigation();
  const focused = useIsFocused();
  const {session: sessionService} = useServices();
  const session = useApp(s => s.session);
  const now = useNow(1000);

  const [confirming, setConfirming] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoStopped = useRef(false);

  const status = session?.status;
  const sessionId = session?.id;
  const bill = session ? billFor(session, now) : null;
  const reached = bill?.metrics.reachedTarget ?? false;

  // A session that already ended belongs on the payment screens.
  useEffect(() => {
    if (!focused || !sessionId) {
      return;
    }
    if (status === 'payment_due' || status === 'stopped') {
      nav.replace('Payment', {sessionId});
    } else if (status === 'payment_failed') {
      nav.replace('PaymentFailure', {sessionId});
    }
  }, [focused, status, sessionId, nav]);

  const stop = async (auto: boolean) => {
    if (!sessionId || stopping) {
      return;
    }
    setStopping(true);
    setError(null);
    try {
      await sessionService.stop(sessionId);
      if (auto) {
        showToast('Target reached. Time to settle up.', 'success');
      }
      nav.replace('Payment', {sessionId});
    } catch (e) {
      setError(describeError(e, 'We couldn’t stop the session.').body);
      setStopping(false);
      setConfirming(false);
      autoStopped.current = false;
    }
  };

  // Chargers stop themselves at the target; do the same, exactly once.
  useEffect(() => {
    if (focused && status === 'active' && reached && !autoStopped.current) {
      autoStopped.current = true;
      stop(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, status, reached]);

  if (!session || !bill) {
    return (
      <Screen title="Charging" hideBack>
        <EmptyState
          icon="plug-zap"
          title="No charging session"
          body="When you start a charger it shows up here with live progress."
          primary={{
            label: 'Scan a charger',
            icon: 'scan-line',
            onPress: () => nav.navigate('ScanQr'),
          }}
          secondary={{
            label: 'Find a charger',
            onPress: () => nav.navigate('Map'),
          }}
        />
      </Screen>
    );
  }

  const {metrics} = bill;
  const idle = reached;

  return (
    <Screen
      title="Charging"
      hideBack
      stack
      footer={
        <PrimaryButton
          label="Stop charging"
          icon="power"
          variant="dark"
          loading={stopping}
          onPress={() => setConfirming(true)}
        />
      }>
      <Card>
        <View style={styles.liveRow}>
          <Pill label="Charging" tone="lime" dot uppercase />
          <Pill label="Estimated meter" tone="amber" />
        </View>
        <SessionRing percent={metrics.socPercent} target={session.targetSoc} />
        <Text style={styles.station} numberOfLines={1}>
          {session.stationName}
        </Text>
        <Text style={styles.conn}>
          {session.connectorLabel} • {session.powerKw} kW
        </Text>
      </Card>

      <View style={styles.grid}>
        <SessionMetricCard
          label="Energy"
          value={metrics.energyKwh.toFixed(1)}
          unit="kWh"
          icon="zap"
        />
        <SessionMetricCard
          label="Elapsed"
          value={formatDuration(metrics.elapsedMin)}
          icon="clock"
        />
        <SessionMetricCard
          label="Cost so far"
          value={formatInr(bill.invoice.baseInr)}
          icon="indian-rupee"
        />
        <SessionMetricCard
          label={`To ${session.targetSoc}%`}
          value={idle ? 'Done' : formatDuration(metrics.minToTarget)}
          icon="timer"
        />
      </View>

      {idle && (
        <Notice
          tone="lime"
          title="Target reached"
          body="Wrapping up your session. Idle fees apply if you stay plugged in after charging."
        />
      )}

      {error && <Notice tone="danger" title="Couldn’t stop" body={error} />}

      <Notice
        tone="info"
        title="Figures are estimated"
        body="They follow the charger’s power and your car’s charge curve until the operator’s meter feed is connected. Your final bill uses the operator’s meter."
      />

      <Card>
        <KeyValue
          label="Rate"
          value={`${formatInr(session.pricePerKwh)}/kWh + 18% GST`}
        />
        <KeyValue label="Started at" value={`${session.startSoc}%`} />
        <KeyValue label="Target" value={`${session.targetSoc}%`} last />
      </Card>

      <View style={styles.center}>
        <TextButton
          label="Having a problem?"
          icon="flag"
          tone="muted"
          onPress={() =>
            nav.navigate('ReportProblem', {stationId: session.stationId})
          }
        />
      </View>

      <ConfirmActionSheet
        visible={confirming}
        title="Stop charging?"
        body={`You’re at ${Math.round(
          metrics.socPercent,
        )}%. We’ll end the session and show what you owe for ${metrics.energyKwh.toFixed(
          1,
        )} kWh.`}
        confirmLabel="Stop & pay"
        cancelLabel="Keep charging"
        icon="power"
        loading={stopping}
        onConfirm={() => stop(false)}
        onCancel={() => setConfirming(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  liveRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  station: {
    ...type.heading,
    color: colors.ink,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  conn: {
    ...type.caption,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 2,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginVertical: spacing.md,
  },
  center: {alignItems: 'center', marginTop: spacing.sm},
});
