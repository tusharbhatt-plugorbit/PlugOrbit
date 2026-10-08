import React, {useMemo, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {sessionTarget} from '../../app/initialStack';
import {ErrorCopy, describeError, errorTone} from '../../domain/describeError';
import {timeAgo} from '../../domain/trust';
import type {Vehicle} from '../../domain/types';
import {useNavigation} from '../../navigation/NavigationContext';
import type {RouteName} from '../../navigation/params';
import {useServices} from '../../services';
import {appStore, useApp} from '../../store/appStore';
import {colors, spacing, type} from '../../theme';
import {
  EmptyState,
  Icon,
  Notice,
  Pill,
  PrimaryButton,
  Screen,
  SecondaryButton,
  showToast,
  useNow,
} from '../../ui';
import {ConfirmActionSheet} from '../../ui/ConfirmActionSheet';
import {VehicleSpecCard} from '../../ui/VehicleSpecCard';

const carName = (v: Pick<Vehicle, 'make' | 'model'>) => `${v.make} ${v.model}`;

/**
 * Your vehicles: the active car is marked and drives compatibility everywhere.
 * Set active, edit, update its battery, remove (blocked while a charging
 * session is open) or add another.
 */
export default function VehiclesScreen(): React.JSX.Element {
  const nav = useNavigation();
  const {vehicle: vehicleService} = useServices();
  const vehicles = useApp(s => s.vehicles);
  const activeId = useApp(s => s.activeVehicleId);
  const battery = useApp(s => s.battery);
  const sessionOpen = useApp(s => s.session !== null);
  const now = useNow();

  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<ErrorCopy | null>(null);
  const [removing, setRemoving] = useState<Vehicle | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<ErrorCopy | null>(null);

  const sorted = useMemo(
    () =>
      [...vehicles].sort(
        (a, b) => Number(b.id === activeId) - Number(a.id === activeId),
      ),
    [vehicles, activeId],
  );

  const setActive = async (v: Vehicle) => {
    setBusyId(v.id);
    setError(null);
    try {
      await vehicleService.setActive(v.id);
      showToast(`${carName(v)} is now your active vehicle.`, 'success');
    } catch (e) {
      setError(describeError(e, 'We couldn’t switch vehicles.'));
    } finally {
      setBusyId(null);
    }
  };

  const closeRemove = () => {
    setRemoving(null);
    setRemoveError(null);
  };

  const confirmRemove = async () => {
    if (!removing) {
      return;
    }
    setRemoveBusy(true);
    setRemoveError(null);
    try {
      await vehicleService.remove(removing.id);
      showToast(`${carName(removing)} removed.`, 'success');
      closeRemove();
    } catch (e) {
      setRemoveError(describeError(e, 'We couldn’t remove this vehicle.'));
    } finally {
      setRemoveBusy(false);
    }
  };

  const goToSession = () => {
    const target = sessionTarget(appStore.get());
    closeRemove();
    if (target) {
      (nav.navigate as (name: RouteName, params?: unknown) => void)(
        target.name,
        target.params,
      );
    }
  };

  const next = removing
    ? vehicles.find(v => v.id !== removing.id) ?? null
    : null;
  const removingActive = removing !== null && removing.id === activeId;

  return (
    <Screen
      title="Your vehicles"
      footer={
        vehicles.length > 0 ? (
          <PrimaryButton
            label="Add vehicle"
            icon="plus"
            onPress={() => nav.navigate('VehicleSetup')}
          />
        ) : undefined
      }>
      {vehicles.length === 0 ? (
        <EmptyState
          icon="car"
          title="No vehicle yet"
          body="Add your EV and we’ll only show chargers that fit your car."
          primary={{
            label: 'Add your EV',
            icon: 'plus',
            onPress: () => nav.navigate('VehicleSetup'),
          }}
        />
      ) : (
        <>
          <Text style={styles.lead}>
            Chargers are matched to your active vehicle.
          </Text>
          {error && (
            <View style={styles.gap}>
              <Notice
                tone={errorTone(error)}
                title={error.title}
                body={error.body}
              />
            </View>
          )}
          <View style={styles.list}>
            {sorted.map(v => {
              const active = v.id === activeId;
              return (
                <VehicleSpecCard
                  key={v.id}
                  spec={v}
                  selected={active}
                  badge={
                    active ? (
                      <Pill
                        label="Active"
                        tone="dark"
                        icon="circle-check"
                        uppercase
                      />
                    ) : undefined
                  }
                  footer={
                    <>
                      {active && battery && (
                        <View style={styles.battery}>
                          <Icon
                            name="battery-charging"
                            size={16}
                            color={colors.limeDark}
                          />
                          <Text style={styles.batteryText}>
                            {battery.percent}% •{' '}
                            {battery.source === 'vehicle'
                              ? 'read from your car'
                              : battery.source === 'trip_estimate'
                              ? 'estimated on your trip'
                              : 'entered by you'}{' '}
                            • updated {timeAgo(battery.updatedAt, now)}
                          </Text>
                        </View>
                      )}
                      <View style={styles.actions}>
                        <View style={styles.main}>
                          {active ? (
                            <PrimaryButton
                              compact
                              style={styles.btn}
                              label="Update battery"
                              onPress={() => nav.navigate('ManualSoc')}
                            />
                          ) : (
                            <PrimaryButton
                              compact
                              style={styles.btn}
                              label="Set active"
                              loading={busyId === v.id}
                              onPress={() => setActive(v)}
                            />
                          )}
                        </View>
                        <View style={styles.edit}>
                          <SecondaryButton
                            compact
                            style={styles.btn}
                            label="Edit"
                            accessibilityHint={`Edit ${carName(v)}`}
                            onPress={() =>
                              nav.navigate('VehicleSetup', {vehicleId: v.id})
                            }
                          />
                        </View>
                        <View style={styles.remove}>
                          <SecondaryButton
                            compact
                            style={styles.btn}
                            tone="danger"
                            label="Remove"
                            accessibilityHint={`Remove ${carName(v)}`}
                            onPress={() => setRemoving(v)}
                          />
                        </View>
                      </View>
                    </>
                  }
                />
              );
            })}
          </View>
        </>
      )}

      <ConfirmActionSheet
        visible={removing !== null}
        title={
          sessionOpen
            ? 'Finish charging first'
            : `Remove ${removing ? carName(removing) : 'vehicle'}?`
        }
        icon={sessionOpen ? 'zap' : 'trash2'}
        tone={sessionOpen ? 'default' : 'danger'}
        body={
          sessionOpen
            ? 'A charging session is in progress. You can remove a vehicle once it has ended and been paid.'
            : `${
                removingActive && next
                  ? `${carName(next)} becomes your active vehicle. `
                  : removingActive
                  ? 'You’ll need to add a vehicle to see chargers that fit. '
                  : ''
              }Your charging history stays.`
        }
        confirmLabel={sessionOpen ? 'Go to session' : 'Remove vehicle'}
        cancelLabel={sessionOpen ? 'Not now' : 'Keep vehicle'}
        loading={removeBusy}
        onConfirm={sessionOpen ? goToSession : confirmRemove}
        onCancel={closeRemove}>
        {removeError && (
          <Notice
            tone={errorTone(removeError)}
            title={removeError.title}
            body={removeError.body}
          />
        )}
      </ConfirmActionSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: {...type.body, color: colors.muted},
  gap: {marginTop: spacing.lg},
  list: {gap: spacing.md, marginTop: spacing.lg},
  battery: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.md,
  },
  batteryText: {...type.caption, color: colors.inkSoft, flex: 1},
  actions: {flexDirection: 'row', gap: spacing.sm},
  btn: {paddingHorizontal: spacing.sm},
  main: {flex: 1.5},
  edit: {flex: 1},
  remove: {flex: 1.2},
});
