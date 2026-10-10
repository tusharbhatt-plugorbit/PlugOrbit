import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {ErrorCopy, describeError, errorTone} from '../../domain/describeError';
import {
  cardBrand,
  digitsOnly,
  formatCardNumber,
  formatExpiry,
  maskUpi,
  validateCardNumber,
  validateExpiry,
  validateUpiId,
} from '../../domain/paymentForm';
import type {PaymentMethod} from '../../domain/types';
import {useServices} from '../../services';
import {useApp} from '../../store/appStore';
import {colors, spacing, type} from '../../theme';
import {
  BottomSheet,
  EmptyState,
  Icon,
  Notice,
  PaymentMethodCard,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SegmentedControl,
  TextField,
  showToast,
} from '../../ui';
import {ConfirmActionSheet} from '../../ui/ConfirmActionSheet';

type Kind = 'upi' | 'card';
const KINDS = [
  {value: 'upi' as const, label: 'UPI ID'},
  {value: 'card' as const, label: 'Card'},
];

/**
 * Payment methods. Only a verified method can start a charger from the app (we
 * place a hold first); unverified ones are explained, not hidden.
 */
export default function PaymentMethodsScreen(): React.JSX.Element {
  const {payment} = useServices();
  const methods = useApp(s => s.paymentMethods);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<ErrorCopy | null>(null);
  const [explain, setExplain] = useState<PaymentMethod | null>(null);

  // Add-method sheet
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<Kind>('upi');
  const [upi, setUpi] = useState('');
  const [cardNo, setCardNo] = useState('');
  const [expiry, setExpiry] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<ErrorCopy | null>(null);

  const upiError = kind === 'upi' ? validateUpiId(upi) : null;
  const cardError = kind === 'card' ? validateCardNumber(cardNo) : null;
  const expiryError = kind === 'card' ? validateExpiry(expiry) : null;

  const openAdd = () => {
    setExplain(null);
    setKind('upi');
    setUpi('');
    setCardNo('');
    setExpiry('');
    setSubmitted(false);
    setAddError(null);
    setAdding(true);
  };

  const makeDefault = async (m: PaymentMethod) => {
    setBusyId(m.id);
    setError(null);
    try {
      await payment.setDefault(m.id);
      showToast(`${m.label} ${m.detail} is now your default.`, 'success');
    } catch (e) {
      setError(describeError(e, 'We couldn’t change your default.'));
    } finally {
      setBusyId(null);
    }
  };

  const add = async () => {
    setSubmitted(true);
    if (kind === 'upi' ? upiError : cardError || expiryError) {
      return;
    }
    const digits = digitsOnly(cardNo);
    const next =
      kind === 'upi'
        ? {kind: 'upi' as const, label: 'UPI', detail: maskUpi(upi)}
        : {
            kind: 'card' as const,
            label: cardBrand(digits),
            detail: `•••• ${digits.slice(-4)}`,
          };
    if (methods.some(m => m.kind === next.kind && m.detail === next.detail)) {
      setAddError({
        kind: 'unknown',
        title: 'Already saved',
        body: 'You’ve already added this payment method.',
      });
      return;
    }
    setSaving(true);
    setAddError(null);
    try {
      // TODO(integration): send the UPI ID / card to the payment gateway for
      // tokenisation and verification. The app must never store a full card
      // number; the mock keeps only a masked label.
      const created = await payment.addMethod(next);
      setAdding(false);
      showToast(
        created.validated
          ? `${created.label} ${created.detail} added and verified.`
          : `${created.label} ${created.detail} added. It still needs verifying.`,
        'success',
      );
    } catch (e) {
      setAddError(describeError(e, 'We couldn’t add this payment method.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      title="Payment methods"
      footer={
        methods.length > 0 ? (
          <PrimaryButton
            label="Add payment method"
            icon="plus"
            onPress={openAdd}
          />
        ) : undefined
      }>
      {methods.length === 0 ? (
        <EmptyState
          icon="credit-card"
          title="No payment methods yet"
          body="Add a UPI ID or card to start chargers from the app. We hold a small amount first and only charge what you use."
          primary={{
            label: 'Add payment method',
            icon: 'plus',
            onPress: openAdd,
          }}
        />
      ) : (
        <>
          <Notice
            tone="info"
            icon="shield-check"
            title="Verified methods can start chargers"
            body="We place a temporary hold on a verified UPI ID or card before a remote start, then charge only what you use."
          />
          {error && (
            <View style={styles.gap}>
              <Notice
                tone={errorTone(error)}
                title={error.title}
                body={error.body}
              />
            </View>
          )}
          <Text style={styles.hint}>Tap a method to make it your default.</Text>
          <View style={styles.list}>
            {methods.map(m => (
              <View key={m.id}>
                <PaymentMethodCard
                  method={m}
                  selected={m.isDefault}
                  onPress={
                    busyId !== null
                      ? undefined
                      : m.validated
                      ? m.isDefault
                        ? undefined
                        : () => makeDefault(m)
                      : () => setExplain(m)
                  }
                />
                {!m.validated && (
                  <View style={styles.unverified}>
                    <Icon
                      name="triangle-alert"
                      size={14}
                      color={colors.amber}
                    />
                    <Text style={styles.unverifiedText}>
                      Can’t start a charger from the app. Tap to see why.
                    </Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        </>
      )}

      <ConfirmActionSheet
        visible={explain !== null}
        title="Why isn’t this verified?"
        icon="shield-check"
        body={`${explain?.label ?? 'This method'} ${
          explain?.detail ?? ''
        } hasn’t been checked with its provider, so we can’t place a hold on it. That means it can’t be used to start a charger from the app. You can still use a verified UPI ID or card.`}
        confirmLabel="Add a verified method"
        cancelLabel="Got it"
        onConfirm={openAdd}
        onCancel={() => setExplain(null)}
      />

      <BottomSheet
        visible={adding}
        onClose={() => setAdding(false)}
        dismissable={!saving}
        title="Add payment method">
        <SegmentedControl options={KINDS} value={kind} onChange={setKind} />
        {kind === 'upi' ? (
          <TextField
            label="UPI ID"
            value={upi}
            onChangeText={setUpi}
            placeholder="name@bank"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            icon="smartphone"
            error={submitted ? upiError ?? undefined : undefined}
            helper="We keep a masked version, never your UPI PIN."
          />
        ) : (
          <>
            <TextField
              label="Card number"
              value={cardNo}
              onChangeText={t => setCardNo(formatCardNumber(t))}
              placeholder="1234 5678 9012 3456"
              keyboardType="number-pad"
              icon="credit-card"
              error={submitted ? cardError ?? undefined : undefined}
            />
            <TextField
              label="Expiry (MM/YY)"
              value={expiry}
              onChangeText={t => setExpiry(formatExpiry(t))}
              placeholder="MM/YY"
              keyboardType="number-pad"
              maxLength={5}
              error={submitted ? expiryError ?? undefined : undefined}
              helper="We keep only the last 4 digits of your card."
            />
          </>
        )}
        {addError && (
          <Notice
            tone={errorTone(addError)}
            title={addError.title}
            body={addError.body}
          />
        )}
        <PrimaryButton
          label={kind === 'upi' ? 'Add UPI ID' : 'Add card'}
          icon="check"
          loading={saving}
          onPress={add}
        />
        <SecondaryButton
          label="Cancel"
          disabled={saving}
          onPress={() => setAdding(false)}
        />

      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: {marginTop: spacing.md},
  hint: {...type.caption, color: colors.muted, marginTop: spacing.lg},
  list: {gap: spacing.md, marginTop: spacing.sm},
  unverified: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  unverifiedText: {...type.caption, color: colors.amber, flex: 1},
});
