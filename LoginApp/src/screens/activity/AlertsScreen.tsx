import React, {useState} from 'react';
import {StyleSheet, Text} from 'react-native';
import type {AlertPreferences} from '../../domain/types';
import {useNavigation} from '../../navigation/NavigationContext';
import {useServices} from '../../services';
import {useApp} from '../../store/appStore';
import {colors, type} from '../../theme';
import {
  Card,
  Notice,
  PrimaryButton,
  Screen,
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

/** 29 Charging alerts. */
export default function AlertsScreen(): React.JSX.Element {
  const nav = useNavigation();
  const {preferences} = useServices();
  const saved = useApp(s => s.alertPrefs);
  const [draft, setDraft] = useState<AlertPreferences>(saved);
  const [busy, setBusy] = useState(false);
  const dirty = ROWS.some(r => draft[r.key] !== saved[r.key]);

  const save = async () => {
    setBusy(true);
    try {
      await preferences.setAlerts(draft);
      showToast('Alert preferences saved.', 'success');
      nav.goBack();
    } catch {
      showToast('Couldn’t save. Try again.', 'warn');
    }
    setBusy(false);
  };

  return (
    <Screen
      title="Charging alerts"
      stack
      footer={
        <PrimaryButton
          label={dirty ? 'Save' : 'Done'}
          icon="check"
          loading={busy}
          onPress={dirty ? save : nav.goBack}
        />
      }>
      <Text style={styles.lead}>Tell me when…</Text>
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
        body="Push delivery needs the notification service, which isn’t connected in this build."
      />
    </Screen>
  );
}

const styles = StyleSheet.create({lead: {...type.display, color: colors.ink}});
