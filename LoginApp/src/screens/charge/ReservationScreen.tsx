import React, {useMemo, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {describeError} from '../../domain/describeError';
import {useNavigation, useRoute} from '../../navigation/NavigationContext';
import {useServices} from '../../services';
import {colors, radii, spacing, type} from '../../theme';
import {formatClock} from '../../utils/format';
import {
  AsyncView,
  Card,
  EmptyState,
  Icon,
  KeyValue,
  Notice,
  PrimaryButton,
  Screen,
  SecondaryButton,
  showToast,
  TextButton,
  useResource,
} from '../../ui';
import {useHeldReservation} from '../../ui/useHeldReservation';
import {ConfirmActionSheet} from '../../ui/ConfirmActionSheet';

const HOLD_MIN = 10;
const STEP_MS = 15 * 60_000;

/** Next four quarter-hour arrival slots, at least 15 minutes from now. */
function slotsFrom(now: number): number[] {
  const first = Math.ceil((now + STEP_MS) / STEP_MS) * STEP_MS;
  return [0, 1, 2, 3].map(i => first + i * STEP_MS);
}

/**
 * 26 Reserve charger. Only PlugOrbit partner (integrated) chargers can hold a
 * bay. TODO(integration): operator reservation API.
 */
export default function ReservationScreen(): React.JSX.Element {
  const nav = useNavigation();
  const {params} = useRoute<'Reservation'>();
  const {station: stationService} = useServices();
  const reservation = useHeldReservation();
  const res = useResource(
    () => stationService.get(params.stationId),
    [params.stationId],
  );

  const [slotIdx, setSlotIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const slots = useMemo(() => slotsFrom(Date.now()), []);

  const mine =
    reservation && reservation.stationId === params.stationId
      ? reservation
      : null;

  const reserve = async () => {
    setSaving(true);
    setError(null);
    try {
      await stationService.reserve(params.stationId, slots[slotIdx], HOLD_MIN);
      showToast('Charger reserved.', 'success');
    } catch (e) {
      setError(describeError(e, 'We couldn’t reserve this charger.').body);
    }
    setSaving(false);
  };

  const cancel = async () => {
    setSaving(true);
    try {
      await stationService.cancelReservation();
      showToast('Reservation cancelled.', 'info');
      setCancelling(false);
    } catch (e) {
      setError(describeError(e, 'We couldn’t cancel the reservation.').body);
    }
    setSaving(false);
  };

  return (
    <Screen
      title="Reserve charger"
      stack
      footer={
        mine ? (
          <>
            <PrimaryButton
              label="Navigate there"
              icon="navigation"
              onPress={() =>
                nav.replace('Navigation', {stationId: params.stationId})
              }
            />
            <SecondaryButton
              label="Cancel reservation"
              tone="danger"
              onPress={() => setCancelling(true)}
            />
          </>
        ) : res.data && res.data.integration === 'integrated' ? (
          <PrimaryButton
            label="Reserve"
            icon="calendar-check"
            loading={saving}
            disabled={!!reservation}
            onPress={reserve}
          />
        ) : null
      }>
      <AsyncView
        resource={res}
        errorTitle="Couldn’t load this charger"
        render={station => {
          if (station.integration !== 'integrated') {
            return (
              <EmptyState
                icon="calendar-clock"
                title="Reservations aren’t available here"
                body={`${station.operator} runs this charger, so PlugOrbit can’t hold a bay. You can still navigate there, or join a queue at a partner charger.`}
                primary={{
                  label: 'Navigate',
                  icon: 'navigation',
                  onPress: () =>
                    nav.replace('Navigation', {stationId: station.id}),
                }}
                secondary={{label: 'Back to station', onPress: nav.goBack}}
              />
            );
          }
          if (mine) {
            return (
              <>
                <Card tone="lime">
                  <Text style={styles.kicker}>Reserved</Text>
                  <Text style={styles.big}>{formatClock(mine.arrivalAt)}</Text>
                  <Text style={styles.sub}>
                    {mine.stationName} • connector {mine.connectorLabel}
                  </Text>
                </Card>
                <Card>
                  <KeyValue
                    label="Hold time"
                    value={`${mine.holdMinutes} min after arrival`}
                  />
                  <KeyValue
                    label="Cost"
                    value="Free; you pay for energy only"
                    last
                  />
                </Card>
                <Notice
                  tone="info"
                  title="Arrive within the hold time"
                  body={`We keep the bay for ${mine.holdMinutes} minutes after your slot, then release it for others.`}
                />
              </>
            );
          }
          return (
            <>
              <Text style={styles.lead}>Choose arrival time</Text>
              <Text style={styles.sub}>{station.name}</Text>
              {reservation && (
                <Notice
                  tone="warn"
                  title="You already hold a reservation"
                  body={`${reservation.stationName} at ${formatClock(
                    reservation.arrivalAt,
                  )}. Cancel it to reserve here.`}
                  action={
                    <TextButton
                      label="Open it"
                      onPress={() =>
                        nav.replace('Reservation', {
                          stationId: reservation.stationId,
                        })
                      }
                    />
                  }
                />
              )}
              <View style={styles.slots}>
                {slots.map((t, i) => {
                  const active = i === slotIdx;
                  return (
                    <Pressable
                      key={t}
                      onPress={() => setSlotIdx(i)}
                      accessibilityRole="radio"
                      accessibilityState={{selected: active}}
                      accessibilityLabel={`Arrive at ${formatClock(t)}`}
                      style={[styles.slot, active && styles.slotOn]}>
                      <Text style={styles.slotTime}>{formatClock(t)}</Text>
                      <View style={[styles.radio, active && styles.radioOn]}>
                        {active && (
                          <Icon
                            name="check"
                            size={13}
                            color={colors.ink}
                            strokeWidth={3}
                          />
                        )}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
              <Card>
                <View style={styles.holdRow}>
                  <Icon name="timer" size={20} color={colors.limeDark} />
                  <Text style={styles.holdText}>
                    {HOLD_MIN}-minute hold. We keep a compatible bay for you
                    after your slot starts.
                  </Text>
                </View>
              </Card>
              {error && (
                <Notice tone="danger" title="Couldn’t reserve" body={error} />
              )}
            </>
          );
        }}
      />
      <ConfirmActionSheet
        visible={cancelling}
        title="Cancel your reservation?"
        body="The bay will be released straight away for other drivers."
        confirmLabel="Cancel reservation"
        cancelLabel="Keep it"
        tone="danger"
        loading={saving}
        onConfirm={cancel}
        onCancel={() => setCancelling(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: {...type.h1, color: colors.ink},
  sub: {...type.body, color: colors.muted},
  kicker: {...type.micro, color: colors.limeDark, textTransform: 'uppercase'},
  big: {
    fontSize: 40,
    fontWeight: '800',
    color: colors.ink,
    marginTop: 4,
    letterSpacing: -1,
  },
  slots: {gap: spacing.sm},
  slot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    minHeight: 60,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  slotOn: {borderColor: colors.bg, backgroundColor: colors.limeSoft},
  slotTime: {...type.heading, color: colors.ink},
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.inputBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: {backgroundColor: colors.lime, borderColor: colors.lime},
  holdRow: {flexDirection: 'row', gap: spacing.md, alignItems: 'center'},
  holdText: {...type.body, color: colors.inkSoft, flex: 1},
});
