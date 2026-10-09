import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {DEMO_TIME_SCALE} from '../../domain/charging';
import {ROUTE_FIXTURES} from '../../dev/fixtures';
import {ROUTE_NAMES} from '../../navigation/routeNames';
import {useNavigation} from '../../navigation/NavigationContext';
import type {RouteName} from '../../navigation/params';
import {useServices} from '../../services';
import {
  appStore,
  INITIAL_STATE,
  resetAppData,
  useApp,
} from '../../store/appStore';
import {
  demoStore,
  resetDemo,
  useDemo,
  PaymentFailMode,
} from '../../store/demoStore';
import {seedState} from '../../store/seed';
import {colors, spacing, type} from '../../theme';
import {
  Card,
  ListCard,
  ListRow,
  Notice,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionTitle,
  SegmentedControl,
  showToast,
  ToggleRow,
} from '../../ui';
import {ConfirmActionSheet} from '../../ui/ConfirmActionSheet';

const FAIL_OPTIONS: ReadonlyArray<{value: PaymentFailMode; label: string}> = [
  {value: 'off', label: 'Off'},
  {value: 'next', label: 'Next'},
  {value: 'always', label: 'Always'},
];

const SKIP: ReadonlyArray<RouteName> = ['PresenterTools'];

/**
 * Showcase control panel. Everything here changes only what the MOCK services
 * return, so a presenter can walk through the hard states on demand.
 */
export default function PresenterToolsScreen(): React.JSX.Element {
  const nav = useNavigation();
  const {
    session: sessionService,
    smartDrive,
    vehicle: vehicleService,
  } = useServices();
  const demo = useDemo(s => s);
  const hasSession = useApp(s => s.session !== null);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [jump, setJump] = useState(false);

  const flag = (
    key: keyof typeof demo,
    title: string,
    subtitle: string,
    last = false,
  ) => (
    <ToggleRow
      title={title}
      subtitle={subtitle}
      value={Boolean(demo[key])}
      onValueChange={v => demoStore.set({[key]: v} as Partial<typeof demo>)}
      last={last}
    />
  );

  const startDemoSession = async () => {
    setBusy(true);
    try {
      const method =
        appStore.get().paymentMethods.find(m => m.isDefault && m.validated) ??
        appStore.get().paymentMethods.find(m => m.validated);
      if (!method) {
        showToast('Add a verified payment method first.', 'warn');
      } else {
        await sessionService.start({
          stationId: 'st-chargezone-manesar',
          connectorId: 'st-chargezone-manesar-c1',
          targetSoc: 80,
          paymentMethodId: method.id,
        });
        nav.navigate('ActiveSession');
      }
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : 'Couldn’t start the demo session.',
        'warn',
      );
    }
    setBusy(false);
  };

  // The product's first scenario: Nexon EV, 72%, Delhi to Jaipur.
  const startSmartDriveDemo = async () => {
    setBusy(true);
    try {
      if (!appStore.get().vehicles.length) {
        showToast('Add your car first, then try again.', 'warn');
        nav.navigate('VehicleSetup');
      } else {
        await vehicleService.setBattery(72);
        await smartDrive.start({
          fromLabel: 'Delhi',
          toLabel: 'Jaipur',
          startSoc: 72,
        });
        nav.navigate('SmartDrive');
      }
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : 'Couldn’t start the Smart Drive demo.',
        'warn',
      );
    }
    setBusy(false);
  };

  const resetData = async () => {
    const keep = {signedIn: appStore.get().signedIn};
    resetDemo();
    await resetAppData({
      ...INITIAL_STATE,
      ...keep,
      hydrated: true,
      ...seedState(Date.now()),
    });
    setConfirmReset(false);
    showToast('Demo data reset. Set up your car again.', 'success');
    nav.reset('Home');
  };

  return (
    <Screen title="Presenter tools" stack>
      <Notice
        tone="warn"
        icon="siren"
        title="Presenter tools — demo only"
        body={`These switches change the mock services, not a real backend. Charging runs ${DEMO_TIME_SCALE}x faster than real time so a session fits in a minute.`}
      />

      <SectionTitle title="Make something go wrong" />
      <ListCard>
        {flag('offline', 'Go offline', 'Every request fails; saved data stays')}
        {flag('apiError', 'API error', 'Requests fail with a server error')}
        {flag(
          'integrationDown',
          'Operator link down',
          'Remote start unavailable even on partner chargers',
        )}
        {flag(
          'locationDenied',
          'Location denied',
          'Pretend permission was refused',
        )}
        {flag(
          'cameraDenied',
          'Camera denied',
          'The QR scanner shows its denied state',
        )}
        {flag(
          'noCompatible',
          'No compatible chargers',
          'Nearby searches come back empty',
          true,
        )}
      </ListCard>

      <Card>
        <Text style={styles.label}>Fail the payment</Text>
        <Text style={styles.sub}>
          “Next” fails one payment, then returns to normal.
        </Text>
        <View style={styles.seg}>
          <SegmentedControl
            options={FAIL_OPTIONS}
            value={demo.paymentFail}
            onChange={v => demoStore.set({paymentFail: v})}
          />
        </View>
      </Card>

      <SectionTitle title="Scenarios" />
      <ListCard>
        <ListRow
          icon="sparkles"
          iconTone="lime"
          title="Smart Drive: Delhi to Jaipur at 72%"
          subtitle="Plan the trip, then drive it in the simulator"
          onPress={startSmartDriveDemo}
        />
        <ListRow
          icon="zap-off"
          iconTone="warn"
          title="Make my chosen charger occupied"
          subtitle="Triggers the backup-charger alert"
          onPress={() => {
            // Off then on, so the override re-targets the CURRENT chosen charger
            // even if the switch was already on from an earlier run.
            demoStore.set({stationOccupied: false});
            demoStore.set({stationOccupied: true});
            nav.navigate('BackupAlert');
          }}
        />
        <ListRow
          icon="zap"
          iconTone="lime"
          title={
            hasSession
              ? 'A session is already open'
              : 'Start a demo charging session'
          }
          subtitle={
            hasSession
              ? 'Open it from the banner'
              : 'Manesar C1, target 80%, default payment'
          }
          onPress={
            hasSession ? () => nav.navigate('ActiveSession') : startDemoSession
          }
        />
        <ListRow
          icon="credit-card"
          iconTone="danger"
          title="Fail the next payment"
          subtitle="Then pay at the end of a session"
          onPress={() => {
            demoStore.set({paymentFail: 'next'});
            showToast('The next payment will fail.', 'info');
          }}
          last
        />
      </ListCard>

      <SecondaryButton
        label="Reset demo switches"
        icon="undo2"
        onPress={() => {
          resetDemo();
          showToast('Demo switches reset.', 'success');
        }}
      />
      <SecondaryButton
        label="Reset demo data"
        icon="refresh-cw"
        tone="danger"
        onPress={() => setConfirmReset(true)}
      />

      <SectionTitle title="Jump to a screen" />
      <PrimaryButton
        label={jump ? 'Hide screens' : 'Show all screens'}
        icon={jump ? 'chevron-up' : 'chevron-down'}
        compact
        onPress={() => setJump(!jump)}
        loading={busy}
      />
      {jump && (
        <ListCard>
          {ROUTE_NAMES.filter(r => !SKIP.includes(r)).map((r, i, arr) => (
            <ListRow
              key={r}
              title={r}
              onPress={() =>
                (nav.navigate as (n: RouteName, p?: unknown) => void)(
                  r,
                  ROUTE_FIXTURES[r],
                )
              }
              last={i === arr.length - 1}
            />
          ))}
        </ListCard>
      )}

      <ConfirmActionSheet
        visible={confirmReset}
        title="Reset demo data?"
        body="Clears vehicles, battery, saved items and any session, then reloads the sample history."
        confirmLabel="Reset"
        tone="danger"
        onConfirm={resetData}
        onCancel={() => setConfirmReset(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: {...type.bodyStrong, color: colors.ink},
  sub: {...type.caption, color: colors.muted, marginTop: 2},
  seg: {marginTop: spacing.md},
});
