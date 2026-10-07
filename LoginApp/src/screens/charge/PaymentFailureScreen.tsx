import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {describeError} from '../../domain/describeError';
import {billFor} from '../../domain/sessionBill';
import {useNavigation, useRoute} from '../../navigation/NavigationContext';
import {useServices} from '../../services';
import {useApp} from '../../store/appStore';
import {colors, radii, spacing, type} from '../../theme';
import {formatInr} from '../../utils/format';
import {
  BottomSheet,
  Card,
  EmptyState,
  Icon,
  ListCard,
  ListRow,
  Notice,
  PaymentMethodCard,
  PrimaryButton,
  Screen,
  SecondaryButton,
  useNow,
} from '../../ui';

/**
 * 16 Payment issue. The charge already happened and the session is safe in the
 * store: the driver can retry, switch method, or get help without losing it.
 */
export default function PaymentFailureScreen(): React.JSX.Element {
  const nav = useNavigation();
  const {params} = useRoute<'PaymentFailure'>();
  const {payment} = useServices();
  const session = useApp(s => s.session);
  const methods = useApp(s => s.paymentMethods);
  const now = useNow(60_000);
  const [paying, setPaying] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session || session.id !== params.sessionId) {
    return (
      <Screen title="Payment issue" hideBack>
        <EmptyState
          icon="circle-check"
          title="Nothing left to pay"
          body="This session isn’t waiting on a payment any more."
          primary={{
            label: 'Go home',
            icon: 'house',
            onPress: () => nav.reset('Home'),
          }}
        />
      </Screen>
    );
  }

  const {invoice} = billFor(session, now);
  const validated = methods.filter(m => m.validated);
  const current = methods.find(m => m.id === session.paymentMethodId) ?? null;

  const pay = async (methodId: string) => {
    setPaying(methodId);
    setError(null);
    try {
      const result = await payment.pay(session.id, methodId);
      if (result.ok) {
        setPicking(false);
        nav.replace('Receipt', {sessionId: session.id});
        return;
      }
      setError(result.message);
    } catch (e) {
      setError(describeError(e, 'We couldn’t reach your bank.').body);
    }
    setPaying(null);
  };

  return (
    <Screen
      title="Payment issue"
      hideBack
      stack
      footer={
        <>
          <PrimaryButton
            label={`Retry ${formatInr(invoice.totalInr, true)}`}
            icon="refresh-cw"
            loading={paying !== null && !picking}
            disabled={!current?.validated}
            onPress={() => current && pay(current.id)}
          />
          <SecondaryButton
            label="Choose another method"
            icon="credit-card"
            onPress={() => setPicking(true)}
          />
        </>
      }>
      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <Icon name="circle-alert" size={30} color={colors.danger} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          Payment didn’t go through
        </Text>
        <Text style={styles.sub}>
          {session.failureReason ?? 'We couldn’t take the payment.'}
        </Text>
      </View>

      <Card tone="lime">
        <View style={styles.safeRow}>
          <Icon name="shield-check" size={20} color={colors.limeDark} />
          <Text style={styles.safeText}>
            Your session is safe. You owe {formatInr(invoice.totalInr, true)}{' '}
            for {invoice.energyKwh.toFixed(1)} kWh at {session.stationName}.
            Nothing is lost if you close the app.
          </Text>
        </View>
      </Card>

      {error && <Notice tone="danger" title="Still not working" body={error} />}

      <ListCard>
        <ListRow
          icon="triangle-alert"
          iconTone="warn"
          title="Account may be restricted"
          subtitle="If a card keeps failing, your bank may have blocked it for online payments. Try UPI or call your bank."
          chevron={false}
        />
        <ListRow
          icon="message-circle"
          iconTone="info"
          title="Talk to support"
          subtitle="We’ll look at it with you and keep your session open."
          onPress={() => nav.navigate('Support')}
        />
        <ListRow
          icon="flag"
          title="Report a problem with this payment"
          onPress={() => nav.navigate('ReportProblem', {sessionId: session.id})}
          last
        />
      </ListCard>

      <BottomSheet
        visible={picking}
        onClose={() => setPicking(false)}
        title="Pay with">
        {validated.map(m => (
          <PaymentMethodCard
            key={m.id}
            method={m}
            selected={m.id === paying}
            onPress={() => pay(m.id)}
          />
        ))}
        {validated.length === 0 && (
          <Notice
            tone="warn"
            title="No verified methods"
            body="Add one in Profile → Payment methods."
          />
        )}
        <SecondaryButton
          label="Add a payment method"
          icon="plus"
          onPress={() => {
            setPicking(false);
            nav.navigate('PaymentMethods');
          }}
        />
        {error && picking && (
          <Notice tone="danger" title="Still not working" body={error} />
        )}
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {alignItems: 'center', paddingVertical: spacing.lg, gap: spacing.sm},
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: radii.xl,
    backgroundColor: colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {...type.h1, color: colors.ink, textAlign: 'center'},
  sub: {
    ...type.body,
    color: colors.muted,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  safeRow: {flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start'},
  safeText: {...type.body, color: colors.inkSoft, flex: 1, lineHeight: 20},
});
