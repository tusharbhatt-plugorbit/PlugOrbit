import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {NotifyMode, SmartDrivePrefs} from '../../domain/coDriver';
import type {AlertPreferences} from '../../domain/types';
import {useNavigation} from '../../navigation/NavigationContext';
import {useServices} from '../../services';
import {useApp} from '../../store/appStore';
import {colors, spacing, type} from '../../theme';
import {
  Card,
  Notice,
  PrimaryButton,
  Screen,
  SectionTitle,
  SegmentedControl,
  showToast,
  ToggleRow,
} from '../../ui';

const ROWS: ReadonlyArray<{
  key: keyof AlertPreferences;
  title: string;
  sub: string;
}> = [
  {
    key: 'started',
    title: 'Started',
    sub: 'When your charger confirms the session began',
  },
  {
    key: 'reached80',
    title: '80% reached',
    sub: 'The sweet spot: charging slows after this',
  },
  {
    key: 'ended',
    title: 'Session ended',
    sub: 'When charging stops, with the total',
  },
  {
    key: 'paymentDone',
    title: 'Payment completed',
    sub: 'A receipt confirmation',
  },
  {
    key: 'idleFeeWarning',
    title: 'Idle fee warning',
    sub: 'Before fees start if you stay plugged in',
  },
];

const MODES: ReadonlyArray<{value: NotifyMode; label: string}> = [
  {value: 'calm', label: 'Calm'},
  {value: 'all', label: 'Everything'},
  {value: 'critical_only', label: 'Urgent only'},
];

const MODE_HELP: Record<NotifyMode, string> = {
  calm: 'We speak up when you need to act or your plan changes. Quiet updates stay on the trip screen.',
  all: 'Also keeps the small updates (like “You’re good to drive”) in your inbox. They never pop up.',
  critical_only:
    'Only for emergencies, like a very low battery with no reachable charger. Your trip screen still shows everything.',
};

const REMIND: ReadonlyArray<{value: '20' | '40' | '60'; label: string}> = [
  {value: '20', label: '20 km'},
  {value: '40', label: '40 km'},
  {value: '60', label: '60 km'},
];

/** 29 Charging alerts, and how Smart Drive speaks and acts. */
export default function AlertsScreen(): React.JSX.Element {
  const nav = useNavigation();
  const {preferences} = useServices();
  const saved = useApp(s => s.alertPrefs);
  const savedDrive = useApp(s => s.smartDrivePrefs);
  const [draft, setDraft] = useState<AlertPreferences>(saved);
  const [drive, setDrive] = useState<SmartDrivePrefs>(savedDrive);
  const [busy, setBusy] = useState(false);
  const dirty =
    ROWS.some(r => draft[r.key] !== saved[r.key]) ||
    drive.autoSwitch !== savedDrive.autoSwitch ||
    drive.notifyMode !== savedDrive.notifyMode ||
    drive.remindKm !== savedDrive.remindKm;

  const save = async () => {
    setBusy(true);
    try {
      await Promise.all([
        preferences.setAlerts(draft),
        preferences.setSmartDrive(drive),
      ]);
      showToast('Alert preferences saved.', 'success');
      nav.goBack();
    } catch {
      showToast('Couldn’t save. Try again.', 'warn');
    }
    setBusy(false);
  };

  return (
    <Screen
      title="Alerts"
      stack
      footer={
        <PrimaryButton
          label={dirty ? 'Save' : 'Done'}
          icon="check"
          loading={busy}
          onPress={dirty ? save : nav.goBack}
        />
      }>
      <Text style={styles.lead}>Smart Drive</Text>
      <Card>
        <ToggleRow
          title="Switch automatically"
          subtitle="If your charger can’t be used, move to your backup without asking. We always tell you."
          value={drive.autoSwitch}
          onValueChange={v => setDrive({...drive, autoSwitch: v})}
          last
        />
      </Card>

      <Card>
        <Text style={styles.label}>How much should we tell you?</Text>
        <View style={styles.seg}>
          <SegmentedControl
            options={MODES}
            value={drive.notifyMode}
            onChange={v => setDrive({...drive, notifyMode: v})}
          />
        </View>
        <Text style={styles.help}>{MODE_HELP[drive.notifyMode]}</Text>
      </Card>

      <Card>
        <Text style={styles.label}>Remind me about a charging stop</Text>
        <View style={styles.seg}>
          <SegmentedControl
            options={REMIND}
            value={String(drive.remindKm) as '20' | '40' | '60'}
            onChange={v => setDrive({...drive, remindKm: Number(v)})}
          />
        </View>
        <Text style={styles.help}>
          How far before the stop we let you know. Closer than that we only
          mention it again when you’re a few minutes away.
        </Text>
      </Card>

      <SectionTitle title="Charging alerts" />
      <Card>
        {ROWS.map((r, i) => (
          <ToggleRow
            key={r.key}
            title={r.title}
            subtitle={r.sub}
            value={draft[r.key]}
            onValueChange={v => setDraft({...draft, [r.key]: v})}
            last={i === ROWS.length - 1}
          />
        ))}
      </Card>
      <Notice
        tone="info"
        title="Alerts are local to this demo"
        body="They appear in the app. Delivering them while the app is closed needs the push notification service, which isn’t connected in this build."
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: {...type.display, color: colors.ink},
  label: {...type.bodyStrong, color: colors.ink},
  seg: {marginTop: spacing.md},
  help: {
    ...type.caption,
    color: colors.muted,
    marginTop: spacing.md,
    lineHeight: 18,
  },
});
