import React, {useMemo, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {describeError} from '../../domain/describeError';
import {billFor} from '../../domain/sessionBill';
import {useNavigation, useRoute} from '../../navigation/NavigationContext';
import {useServices} from '../../services';
import {useApp} from '../../store/appStore';
import {colors, spacing, type} from '../../theme';
import {formatDuration, formatInr} from '../../utils/format';
import {
  Card,
  EmptyState,
  KeyValue,
  Notice,
  PaymentMethodCard,
  PrimaryButton,
  Screen,
  SectionTitle,
  TextButton,
  useNow,
} from '../../ui';

/**
 * 15 Payment. The total comes from the same maths as the live screen. The
 * session stays in the store until the payment succeeds, so nothing is lost if
 * the app is closed or the network drops here.
 */
export default function PaymentScreen(): React.JSX.Element {
  const nav = useNavigation();
  const {params} = useRoute<'Payment'>();
  const {payment} = useServices();
  const session = useApp(s => s.session);
  const methods = useApp(s => s.paymentMethods);
  const paidAlready = useApp(s =>
    s.history.some(h => h.id === params.sessionId),
  );
  const now = useNow(30_000);

  const validated = useMemo(() => methods.filter(m => m.validated), [methods]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<{
    title: string;
    body: string;
    offline: boolean;
  } | null>(null);

  if (!session || session.id !== params.sessionId) {
    return (
      <Screen title="Payment" hideBack>
        <EmptyState
          icon={paidAlready ? 'circle-check' : 'receipt'}
          title={paidAlready ? 'Already paid' : 'Nothing to pay'}
          body={
            paidAlready
              ? 'This session is settled. Your receipt is in Activity.'
              : 'We couldn’t find an open session to pay for.'
          }
          primary={{
            label: paidAlready ? 'View receipt' : 'Go home',
            icon: paidAlready ? 'receipt' : 'house',
            onPress: () =>
              paidAlready
                ? nav.replace('Receipt', {sessionId: params.sessionId})
                : nav.reset('Home'),
          }}
        />
      </Screen>
    );
  }

  const bill = billFor(session, now);
  const {invoice, metrics} = bill;
  const methodId =
    chosen ??
    session.paymentMethodId ??
    validated.find(m => m.isDefault)?.id ??
    validated[0]?.id ??
    null;
  const method = validated.find(m => m.id === methodId) ?? null;

  const pay = async () => {
    if (!method || paying) {
      return;
    }
    setPaying(true);
    setError(null);
    try {
      const result = await payment.pay(session.id, method.id);
      if (result.ok) {
        nav.replace('Receipt', {sessionId: session.id});
      } else {
        nav.replace('PaymentFailure', {sessionId: session.id});
      }
    } catch (e) {
      const copy = describeError(e, 'We couldn’t complete the payment.');
      setError({
        title: copy.title,
        body: copy.body,
        offline: copy.kind === 'offline',
      });
      setPaying(false);
    }
  };

  return (
    <Screen
      title="Payment"
      hideBack
      stack
      footer={
        <PrimaryButton
          label={`Pay ${formatInr(invoice.totalInr, true)}`}
          icon="lock"
          loading={paying}
          disabled={!method}
          onPress={pay}
        />
      }>
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>Total to pay</Text>
        <Text style={styles.heroTotal} accessibilityRole="header">
          {formatInr(invoice.totalInr, true)}
        </Text>
        <Text style={styles.heroSub}>
          {session.stationName} • {formatDuration(metrics.elapsedMin)}
        </Text>
      </View>

      <Card>
        <KeyValue
          label={`${invoice.energyKwh.toFixed(1)} kWh × ${formatInr(
            invoice.pricePerKwh,
            invoice.pricePerKwh % 1 !== 0,
          )}`}
          value={formatInr(invoice.baseInr, true)}
        />
        <KeyValue label="GST (18%)" value={formatInr(invoice.gstInr, true)} />
        <KeyValue
          label="Total"
          value={formatInr(invoice.totalInr, true)}
          emphasis
          last
        />
      </Card>

      <SectionTitle title="Pay with" />
      {validated.length === 0 ? (
        <Notice
          tone="danger"
          title="No verified payment method"
          body="Add one to settle this session. Your session is saved."
          action={
            <TextButton
              label="Add payment method"
              onPress={() => nav.navigate('PaymentMethods')}
            />
          }
        />
      ) : (
        <View style={styles.methods}>
          {validated.map(m => (
            <PaymentMethodCard
              key={m.id}
              method={m}
              selected={m.id === method?.id}
              onPress={() => setChosen(m.id)}
            />
          ))}
        </View>
      )}

      {session.preauthAmountInr > 0 && (
        <Notice
          tone="info"
          icon="shield-check"
          title={`${formatInr(session.preauthAmountInr)} on hold`}
          body="The pre-authorisation is released once this payment goes through; you’re only charged the total above."
        />
      )}

      {error && (
        <Notice
          tone={error.offline ? 'warn' : 'danger'}
          title={error.title}
          body={`${error.body} Your session is saved, so you can pay when you’re back online.`}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {alignItems: 'center', paddingVertical: spacing.lg},
  heroLabel: {...type.label, color: colors.muted},
  heroTotal: {
    fontSize: 44,
    fontWeight: '800',
    color: colors.ink,
    letterSpacing: -1,
    marginTop: 4,
  },
  heroSub: {...type.caption, color: colors.muted, marginTop: 4},
  methods: {gap: spacing.sm},
});
