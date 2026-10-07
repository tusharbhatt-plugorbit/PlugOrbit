import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {invoiceFor} from '../../domain/charging';
import {useNavigation, useRoute} from '../../navigation/NavigationContext';
import {useApp} from '../../store/appStore';
import {colors, spacing, type} from '../../theme';
import {formatDateTime, formatDuration, formatInr} from '../../utils/format';
import {
  Card,
  EmptyState,
  KeyValue,
  ListCard,
  ListRow,
  Pill,
  PrimaryButton,
  Screen,
  SecondaryButton,
  showToast,
} from '../../ui';

/** 19 Session detail: one session in full, with the way to get help or a receipt. */
export default function SessionDetailScreen(): React.JSX.Element {
  const nav = useNavigation();
  const {params} = useRoute<'SessionDetail'>();
  const s = useApp(st => st.history.find(h => h.id === params.sessionId));
  const rated = useApp(st => st.feedbackDone.includes(params.sessionId));

  if (!s) {
    return (
      <Screen title="Session detail">
        <EmptyState
          icon="receipt"
          title="Session not found"
          body="It may have been erased from your history."
          primary={{
            label: 'Back to Activity',
            onPress: () => nav.switchTab('Activity'),
          }}
        />
      </Screen>
    );
  }
  const invoice = invoiceFor(s.energyKwh, s.pricePerKwh);

  return (
    <Screen
      title="Session detail"
      stack
      footer={
        <PrimaryButton
          label="Download receipt"
          icon="file-down"
          // TODO(integration): fetch the GST invoice PDF from the backend.
          onPress={() => showToast('Receipt saved to your files.', 'success')}
        />
      }>
      <View>
        <Text style={styles.title}>{s.stationName}</Text>
        <Text style={styles.sub}>
          {formatDateTime(s.startedAt)} • {s.id}
        </Text>
      </View>

      <Card>
        <KeyValue label="Energy" value={`${s.energyKwh.toFixed(1)} kWh`} />
        <KeyValue label="Duration" value={formatDuration(s.durationMin)} />
        <KeyValue label="Battery" value={`${s.startSoc}% → ${s.endSoc}%`} />
        <KeyValue
          label="Connector"
          value={`${s.connectorLabel} • ${s.powerKw} kW`}
        />
        <KeyValue
          label="Rate"
          value={`${formatInr(s.pricePerKwh, s.pricePerKwh % 1 !== 0)}/kWh`}
          last
        />
      </Card>

      <Card>
        <KeyValue label="Charging" value={formatInr(invoice.baseInr, true)} />
        <KeyValue label="GST (18%)" value={formatInr(invoice.gstInr, true)} />
        <KeyValue label="Total" value={formatInr(s.costInr, true)} emphasis />
        <KeyValue
          label="Status"
          value={
            <Pill
              label={
                s.status === 'paid'
                  ? 'Paid'
                  : s.status === 'refunded'
                  ? 'Refunded'
                  : 'Payment due'
              }
              tone={s.status === 'paid' ? 'lime' : 'amber'}
              uppercase
            />
          }
          last
        />
      </Card>

      <Card>
        <KeyValue
          label="Meter data"
          value={<Pill label="From operator" tone="info" icon="shield-check" />}
          last
        />
        <Text style={styles.fine}>
          Energy and time come from the operator’s meter for this session.
        </Text>
      </Card>

      <ListCard>
        <ListRow
          icon="receipt"
          title="Receipt"
          subtitle={s.receiptNo}
          onPress={() => nav.navigate('Receipt', {sessionId: s.id})}
        />
        {!rated && (
          <ListRow
            icon="star"
            iconTone="lime"
            title="Rate this stop"
            onPress={() => nav.navigate('Feedback', {sessionId: s.id})}
          />
        )}
        <ListRow
          icon="flag"
          title="Report a problem"
          onPress={() => nav.navigate('ReportProblem', {sessionId: s.id})}
        />
        <ListRow
          icon="life-buoy"
          iconTone="info"
          title="Get help with this session"
          onPress={() => nav.navigate('Support')}
          last
        />
      </ListCard>
      <View style={styles.center}>
        <SecondaryButton
          label="Back to Activity"
          compact
          onPress={() => nav.switchTab('Activity')}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {...type.h1, color: colors.ink},
  sub: {...type.caption, color: colors.muted, marginTop: 4},
  fine: {...type.caption, color: colors.muted, paddingBottom: spacing.sm},
  center: {alignItems: 'center'},
});
