import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {ErrorCopy, describeError, errorTone} from '../../domain/describeError';
import {
  chargeHint,
  minutesRangeLabel,
  usableRangeKm,
} from '../../domain/socEstimate';
import {STALE_AFTER_MS, timeAgo} from '../../domain/trust';
import {useNavigation, useRoute} from '../../navigation/NavigationContext';
import {useServices} from '../../services';
import {selectActiveVehicle, useApp} from '../../store/appStore';
import {colors, spacing, type} from '../../theme';
import {
  Card,
  EmptyState,
  ListCard,
  ListRow,
  Notice,
  PercentSlider,
  Pill,
  PrimaryButton,
  Screen,
  TextButton,
  showToast,
  useNow,
} from '../../ui';
import {ExplainRow} from '../../ui/ExplainRow';
import {QuickValueChips} from '../../ui/QuickValueChips';

const QUICK: readonly number[] = [20, 40, 60, 80, 100];

/**
 * 02 Current battery. A big number you can drag or tap, the range it means for
 * the active car, and an honest "updated N min ago". Everything here is a
 * manual reading; connecting the car is the alternative (AutoSoc).
 */
export default function ManualSocScreen(): React.JSX.Element {
  const nav = useNavigation();
  const {params} = useRoute<'ManualSoc'>();
  const onboarding = params?.onboarding === true;
  const {vehicle: vehicleService} = useServices();
  const vehicle = useApp(selectActiveVehicle);
  const battery = useApp(s => s.battery);
  const reserve = useApp(s => s.tripPrefs.minArrivalSocPct);
  const now = useNow();

  const [soc, setSoc] = useState(battery?.percent ?? 50);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ErrorCopy | null>(null);

  // Follow a reading that changes elsewhere (e.g. the car was just connected),
  // but never overwrite what the driver is in the middle of adjusting.
  const storedPercent = battery?.percent;
  useEffect(() => {
    if (!dirty && storedPercent !== undefined) {
      setSoc(storedPercent);
    }
  }, [dirty, storedPercent]);

  const change = (value: number) => {
    if (value !== soc) {
      setSoc(value);
      setDirty(true);
      setError(null);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await vehicleService.setBattery(soc);
      showToast(`Battery set to ${soc}%.`, 'success');
      if (onboarding) {
        nav.reset('Home');
      } else {
        nav.goBack();
      }
    } catch (e) {
      setError(describeError(e, 'We couldn’t save your battery level.'));
      setSaving(false);
    }
  };

  if (!vehicle) {
    return (
      <Screen title="Current battery">
        <EmptyState
          icon="car"
          title="Add your car first"
          body="We need your battery size to turn a percentage into kilometres of range."
          primary={{
            label: 'Add your EV',
            icon: 'plus',
            onPress: () =>
              onboarding
                ? nav.replace('VehicleSetup', {onboarding: true})
                : nav.navigate('VehicleSetup'),
          }}
        />
      </Screen>
    );
  }

  const rangeKm = usableRangeKm(vehicle, soc, reserve);
  const hint = chargeHint(vehicle, soc);
  const low = soc <= reserve;
  const staleMs = battery ? now - battery.updatedAt : 0;
  const stale = !dirty && battery !== null && staleMs > STALE_AFTER_MS;

  const source =
    battery === null
      ? {label: 'Not set yet', tone: 'slate' as const}
      : !dirty && battery.source === 'vehicle'
      ? {label: 'From your car', tone: 'lime' as const}
      : !dirty && battery.source === 'trip_estimate'
      ? {label: 'Estimated on your trip', tone: 'info' as const}
      : {
          label: dirty ? 'Manual • not saved' : 'Manual entry',
          tone: 'info' as const,
        };

  return (
    <Screen
      title="Current battery"
      footer={
        <>
          <PrimaryButton
            label={onboarding ? 'Continue' : 'Update battery'}
            icon={onboarding ? 'arrow-right' : 'check'}
            onPress={save}
            loading={saving}
          />
          {onboarding && (
            <View style={styles.skip}>
              <TextButton
                label="Skip for now"
                tone="muted"
                onPress={() => nav.reset('Home')}
              />
            </View>
          )}
        </>
      }>
      <Text style={styles.lead}>
        {onboarding
          ? 'Step 2 of 2. How full is your battery now?'
          : `How full is your ${vehicle.make} ${vehicle.model} right now?`}
      </Text>

      <View style={styles.block}>
        <Card>
          <View style={styles.cardHead}>
            <Text style={styles.cardLabel}>State of charge</Text>
            <Pill label={source.label} tone={source.tone} />
          </View>
          <Text
            style={[styles.hero, low && styles.heroLow]}
            accessibilityLabel={`${soc} percent battery`}>
            {soc}%
          </Text>
          <Text style={styles.updated}>
            {dirty
              ? 'Not saved yet'
              : battery
              ? `Updated ${timeAgo(battery.updatedAt, now)}`
              : 'Drag the slider or pick a value'}
          </Text>
          <View style={styles.slider}>
            <PercentSlider
              value={soc}
              onChange={change}
              label="Battery level"
            />
            <View style={styles.scale}>
              <Text style={styles.scaleText}>0%</Text>
              <Text style={styles.scaleText}>100%</Text>
            </View>
          </View>
          <View style={styles.rangeBox}>
            <Text style={styles.range}>
              Estimated usable range:{' '}
              <Text style={styles.rangeValue}>~{rangeKm} km</Text>
            </Text>
            <Text style={styles.rangeNote}>
              Keeps your {reserve}% safety reserve. Real range changes with
              speed, load and weather.
            </Text>
          </View>
        </Card>
      </View>

      <View style={styles.chips}>
        <QuickValueChips
          label="Quick battery levels"
          values={QUICK}
          value={soc}
          onSelect={change}
          format={v => `${v}%`}
        />
      </View>

      {error && (
        <View style={styles.block}>
          <Notice
            tone={errorTone(error)}
            title={error.title}
            body={error.body}
          />
        </View>
      )}

      {low && (
        <View style={styles.block}>
          <Notice
            tone="warn"
            title={`At or below your ${reserve}% reserve`}
            body="Find a charger before driving further. Chargers shown fit your car."
            action={
              <View style={styles.noticeAction}>
                <TextButton
                  label="Find a charger"
                  icon="map-pin"
                  onPress={() => nav.navigate('StationList')}
                />
              </View>
            }
          />
        </View>
      )}

      {stale && battery && (
        <View style={styles.block}>
          <Notice
            tone="warn"
            icon="clock"
            title={`Last updated ${timeAgo(battery.updatedAt, now)}`}
            body="Your battery changes as you drive. Update it before you plan a trip."
          />
        </View>
      )}

      <View style={styles.block}>
        <ListCard>
          {hint ? (
            <ExplainRow
              icon="timer"
              tone="lime"
              title={`${hint.fromSoc}% to ${hint.toSoc}%: ${minutesRangeLabel(
                hint.minMinutes,
                hint.maxMinutes,
              )}`}
              body={`On a ${hint.chargerKw} kW ${
                hint.kind === 'dc' ? 'DC fast' : 'AC'
              } charger${
                hint.effectiveKw < hint.chargerKw
                  ? `. Your car limits it to ${hint.effectiveKw} kW`
                  : ''
              }. A range, because speed tapers as the battery fills.`}
            />
          ) : (
            <ExplainRow
              icon="timer"
              tone="lime"
              title="Battery is already high"
              body="Fast chargers slow down a lot near full, so most trips stop at about 80%."
            />
          )}
          <ListRow
            icon="bluetooth"
            iconTone="info"
            title="Connect your car instead"
            subtitle="Read the battery from your car so you don’t have to type it"
            onPress={() => nav.navigate('AutoSoc')}
            last
          />
        </ListCard>
      </View>
      <View style={styles.change}>
        <TextButton
          label={`Change safety reserve (${reserve}%)`}
          icon="shield-check"
          onPress={() => nav.navigate('TripPreferences')}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: {...type.body, color: colors.muted},
  block: {marginTop: spacing.lg},
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardLabel: {...type.label, color: colors.muted},
  hero: {
    ...type.hero,
    color: colors.ink,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  heroLow: {color: colors.danger},
  updated: {
    ...type.caption,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  slider: {marginTop: spacing.lg},
  scale: {flexDirection: 'row', justifyContent: 'space-between'},
  scaleText: {...type.caption, color: colors.muted},
  rangeBox: {
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  range: {...type.bodyStrong, color: colors.inkSoft},
  rangeValue: {...type.heading, color: colors.ink},
  rangeNote: {...type.caption, color: colors.muted, marginTop: spacing.xs},
  chips: {marginTop: spacing.lg},
  change: {alignItems: 'center', marginTop: spacing.md},
  skip: {alignItems: 'center'},
  noticeAction: {alignSelf: 'flex-start', marginTop: spacing.xs},
});
