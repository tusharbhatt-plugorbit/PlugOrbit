import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {ErrorCopy, describeError, errorTone} from '../../domain/describeError';
import type {PrivacyPreferences} from '../../domain/types';
import {useServices} from '../../services';
import {useApp} from '../../store/appStore';
import {colors, spacing, type} from '../../theme';
import {
  ListCard,
  ListRow,
  Notice,
  Screen,
  SectionTitle,
  ToggleRow,
  showToast,
} from '../../ui';
import {ConfirmActionSheet} from '../../ui/ConfirmActionSheet';
import {ExplainRow} from '../../ui/ExplainRow';

const TOGGLES: ReadonlyArray<{
  key: keyof PrivacyPreferences;
  title: string;
  body: string;
}> = [
  {
    key: 'preciseLocation',
    title: 'Precise location',
    body: 'On: chargers are sorted by exact distance and routes start where you are. Off: we use only the area you search.',
  },
  {
    key: 'vehicleBatteryData',
    title: 'Vehicle battery data',
    body: 'On: a connected car can share its battery level. Off: we stop reading your car and your battery stays manual.',
  },
  {
    key: 'history',
    title: 'Charging history',
    body: 'On: sessions and receipts are kept in Activity. Off: new sessions are not added to your history.',
  },
  {
    key: 'personalisedOffers',
    title: 'Personalised offers',
    body: 'On: offers can use your charging habits. Off: you only see general offers. Offers never change which chargers rank first.',
  },
];

/**
 * 40 Privacy & connected data. Each switch is saved immediately through the
 * preferences service, with plain wording for what it changes, an honest note on
 * where this build's data comes from, and a confirmed "erase my history".
 */
export default function PrivacyScreen(): React.JSX.Element {
  const {preferences, vehicle} = useServices();
  const privacy = useApp(s => s.privacy);
  const linked = useApp(s => s.vehicleLink.connected);
  const sessionCount = useApp(s => s.history.length);
  const ticketCount = useApp(s => s.tickets.length);
  const notificationCount = useApp(s => s.notifications.length);
  const stored = sessionCount + ticketCount + notificationCount;

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ErrorCopy | null>(null);
  const [confirmErase, setConfirmErase] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [eraseError, setEraseError] = useState<ErrorCopy | null>(null);

  const toggle = async (key: keyof PrivacyPreferences, value: boolean) => {
    setSaving(true);
    setError(null);
    try {
      await preferences.setPrivacy({...privacy, [key]: value});
      // Turning battery data off must actually stop reading the car.
      if (key === 'vehicleBatteryData' && !value && linked) {
        await vehicle.disconnectVehicle();
        showToast('Battery data off. Your car was disconnected.', 'info');
      }
    } catch (e) {
      setError(describeError(e, 'We couldn’t save that setting.'));
    } finally {
      setSaving(false);
    }
  };

  const erase = async () => {
    setErasing(true);
    setEraseError(null);
    try {
      await preferences.eraseHistory();
      setConfirmErase(false);
      showToast('Your history was erased.', 'success');
    } catch (e) {
      setEraseError(describeError(e, 'We couldn’t erase your history.'));
    } finally {
      setErasing(false);
    }
  };

  return (
    <Screen title="Privacy & data">
      <Text style={styles.lead}>
        You decide what PlugOrbit may use. Changes are saved as you make them.
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

      <SectionTitle title="What PlugOrbit may use" />
      <ListCard>
        {TOGGLES.map((t, i) => (
          <ToggleRow
            key={t.key}
            title={t.title}
            subtitle={t.body}
            value={privacy[t.key]}
            disabled={saving}
            onValueChange={v => toggle(t.key, v)}
            last={i === TOGGLES.length - 1}
          />
        ))}
      </ListCard>

      <SectionTitle title="Where data comes from" />
      <ListCard>
        <ExplainRow
          icon="cloud"
          tone="warn"
          title="Charger status and prices"
          body="This build runs on a demo data feed. In production, LIVE appears only for a fresh operator feed. Everything else is labelled Estimated or User-confirmed, with its age."
        />
        <ExplainRow
          icon="map-pin"
          title="Your location"
          body="Used on this device to sort chargers and plan routes. It is never shared with charger operators."
        />
        <ExplainRow
          icon="battery-charging"
          title="Battery level"
          body="Typed in by you, or read from your car if you connect it. We always say which."
        />
        <ExplainRow
          icon="credit-card"
          title="Payments"
          body="Held and charged through your bank or UPI app. We keep only a masked label, never a full card number or your UPI PIN."
          last
        />
      </ListCard>
      <View style={styles.gap}>
        {/* TODO(integration): enforce these switches in the backend; here they are
            saved on the device only. */}
        <Notice
          tone="info"
          title="Demo build"
          body="Your choices are saved on this device. Nothing leaves it, because the demo feed has no real operator or payment backend."
        />
      </View>

      <SectionTitle title="Your data" />
      <ListCard>
        <ListRow
          icon="trash2"
          iconTone="danger"
          title="Erase my history"
          subtitle={
            stored === 0
              ? 'Nothing stored yet'
              : `${sessionCount} session${
                  sessionCount === 1 ? '' : 's'
                } • ${ticketCount} ticket${
                  ticketCount === 1 ? '' : 's'
                } • ${notificationCount} notification${
                  notificationCount === 1 ? '' : 's'
                }`
          }
          onPress={stored === 0 ? undefined : () => setConfirmErase(true)}
          last
        />
      </ListCard>

      <ConfirmActionSheet
        visible={confirmErase}
        title="Erase your history?"
        icon="trash2"
        tone="danger"
        body={`This removes ${sessionCount} charging session${
          sessionCount === 1 ? '' : 's'
        }, ${ticketCount} support ticket${
          ticketCount === 1 ? '' : 's'
        } and ${notificationCount} notification${
          notificationCount === 1 ? '' : 's'
        } from this device. It can’t be undone. Payments you’ve already made are not reversed.`}
        confirmLabel="Erase history"
        cancelLabel="Keep it"
        loading={erasing}
        onConfirm={erase}
        onCancel={() => {
          setConfirmErase(false);
          setEraseError(null);
        }}>
        {eraseError && (
          <Notice
            tone={errorTone(eraseError)}
            title={eraseError.title}
            body={eraseError.body}
          />
        )}
      </ConfirmActionSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: {...type.body, color: colors.muted},
  gap: {marginTop: spacing.lg},
});
