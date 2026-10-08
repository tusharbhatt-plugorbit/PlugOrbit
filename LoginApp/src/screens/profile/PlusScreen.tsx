import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {ErrorCopy, describeError, errorTone} from '../../domain/describeError';
import {PLUS_PRICE_INR, nextRenewalAt} from '../../domain/plusPlan';
import {useNavigation} from '../../navigation/NavigationContext';
import {useServices} from '../../services';
import {useApp} from '../../store/appStore';
import {colors, radii, spacing, type} from '../../theme';
import {formatDate, formatInr} from '../../utils/format';
import {
  Card,
  Icon,
  ListCard,
  Notice,
  Pill,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionTitle,
  showToast,
  useNow,
} from '../../ui';
import {ConfirmActionSheet} from '../../ui/ConfirmActionSheet';
import {ExplainRow} from '../../ui/ExplainRow';

/**
 * 30 PlugOrbit Plus. ₹49 a week. Starting needs a verified payment method; an
 * active plan shows its renewal and can be cancelled behind a confirmation.
 */
export default function PlusScreen(): React.JSX.Element {
  const nav = useNavigation();
  const {preferences} = useServices();
  const plus = useApp(s => s.plus);
  const methods = useApp(s => s.paymentMethods);
  const now = useNow(60000);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCopy | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const billing =
    methods.find(m => m.isDefault && m.validated) ??
    methods.find(m => m.validated) ??
    null;
  const price = `${formatInr(PLUS_PRICE_INR)} / week`;

  const run = async (active: boolean) => {
    setBusy(true);
    setError(null);
    try {
      // TODO(integration): create / cancel the subscription in the billing backend.
      await preferences.setPlus(active);
      setConfirmCancel(false);
      showToast(
        active
          ? 'Welcome to PlugOrbit Plus.'
          : 'Plus cancelled. You won’t be billed again.',
        active ? 'success' : 'info',
      );
    } catch (e) {
      setError(
        describeError(
          e,
          active ? 'We couldn’t start Plus.' : 'We couldn’t cancel Plus.',
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const renewal =
    plus.active && plus.since !== null ? nextRenewalAt(plus.since, now) : null;

  return (
    <Screen
      title="PlugOrbit Plus"
      footer={
        plus.active ? (
          <SecondaryButton
            label="Cancel Plus"
            tone="danger"
            onPress={() => setConfirmCancel(true)}
          />
        ) : billing ? (
          <>
            <PrimaryButton
              label={`Start Plus • ${price}`}
              icon="crown"
              loading={busy}
              onPress={() => run(true)}
            />
            <Text style={styles.fine}>
              Billed {price} to {billing.label} {billing.detail}. Cancel any
              time.
            </Text>
          </>
        ) : (
          <PrimaryButton
            label="Add a payment method"
            icon="credit-card"
            onPress={() => nav.navigate('PaymentMethods')}
          />
        )
      }>
      <Card tone="dark">
        <View style={styles.heroTop}>
          <View style={styles.crown}>
            <Icon name="crown" size={22} color={colors.ink} />
          </View>
          <Text style={styles.heroName}>PlugOrbit Plus</Text>
          {plus.active && (
            <Pill label="Active" tone="lime" icon="circle-check" uppercase />
          )}
        </View>
        <View style={styles.priceRow}>
          <Text style={styles.price}>{formatInr(PLUS_PRICE_INR)}</Text>
          <Text style={styles.per}>/ week</Text>
        </View>
        <Text style={styles.heroBody}>
          {plus.active && plus.since !== null && renewal !== null
            ? `Member since ${formatDate(plus.since)} • renews ${formatDate(
                renewal,
              )}`
            : 'Lower fees and priority help, for the weeks you drive the most.'}
        </Text>
      </Card>

      {error && (
        <View style={styles.gap}>
          <Notice
            tone={errorTone(error)}
            title={error.title}
            body={error.body}
          />
        </View>
      )}

      {!plus.active && !billing && (
        <View style={styles.gap}>
          <Notice
            tone="warn"
            title="Add a verified payment method first"
            body="Plus is billed weekly, so we need a verified UPI ID or card on file."
          />
        </View>
      )}

      <SectionTitle title="What you get" />
      <ListCard>
        <ExplainRow
          icon="percent"
          tone="lime"
          title="Reduced platform fee"
          body="A lower PlugOrbit fee on every charge you start from the app. Operators’ energy prices don’t change."
        />
        <ExplainRow
          icon="headset"
          tone="lime"
          title="Priority support"
          body="Your tickets and payment issues are looked at first."
        />
        <ExplainRow
          icon="route"
          tone="lime"
          title="Trip benefits"
          body="More saved routes and early alerts when a stop on your trip changes."
        />
        <ExplainRow
          icon="calendar-clock"
          tone="lime"
          title="Reservation access"
          body="Hold a charger before you arrive, at stations whose operator supports it."
          last
        />
      </ListCard>

      {plus.active && billing && (
        <>
          <SectionTitle title="Your plan" />
          <ListCard>
            <ExplainRow
              icon="calendar"
              title="Next renewal"
              body={
                renewal !== null
                  ? `${formatDate(renewal)} • ${price} to ${billing.label} ${
                      billing.detail
                    }`
                  : price
              }
              last
            />
          </ListCard>
        </>
      )}

      <View style={styles.gap}>
        {/* TODO(integration): billing. Plus is switched on locally, nothing is charged. */}
        <Notice
          tone="info"
          title="Demo build"
          body="Billing isn’t connected yet, so starting Plus here switches the plan on without charging you."
        />
      </View>

      <ConfirmActionSheet
        visible={confirmCancel}
        title="Cancel PlugOrbit Plus?"
        icon="crown"
        tone="danger"
        body="Plus ends right away and you won’t be billed again. Fees and support go back to the standard plan. You can start Plus again any time."
        confirmLabel="Cancel Plus"
        cancelLabel="Keep Plus"
        loading={busy}
        onConfirm={() => run(false)}
        onCancel={() => setConfirmCancel(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: {marginTop: spacing.lg},
  heroTop: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  crown: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroName: {...type.heading, color: '#FFFFFF', flex: 1},
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  price: {...type.hero, color: colors.lime},
  per: {...type.title, color: colors.chipText},
  heroBody: {...type.body, color: colors.chipText, marginTop: spacing.sm},
  fine: {...type.caption, color: colors.muted, textAlign: 'center'},
});
