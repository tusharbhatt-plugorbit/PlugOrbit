import React, {useState} from 'react';
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native';
import {ErrorCopy, describeError, errorTone} from '../../domain/describeError';
import {describeSocSource} from '../../domain/socEstimate';
import {useNavigation} from '../../navigation/NavigationContext';
import {useServices} from '../../services';
import {useApp} from '../../store/appStore';
import {colors, radii, spacing, type} from '../../theme';
import {
  Card,
  Icon,
  IconName,
  ListCard,
  ListRow,
  Notice,
  Pill,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionTitle,
  TextButton,
  showToast,
  useNow,
} from '../../ui';
import {ChoiceCard} from '../../ui/ChoiceCard';
import {ExplainRow} from '../../ui/ExplainRow';

type Method = 'oem' | 'obd';

const METHODS: Record<
  Method,
  {title: string; body: string; icon: IconName; connecting: string}
> = {
  oem: {
    title: 'OEM account',
    body: 'Sign in with your car maker’s connected-car account. No hardware needed.',
    icon: 'cloud',
    connecting: 'Contacting your car maker’s account…',
  },
  obd: {
    title: 'Bluetooth OBD',
    body: 'Pair an OBD-II Bluetooth dongle plugged into your car’s diagnostic port.',
    icon: 'bluetooth',
    connecting: 'Looking for your OBD dongle…',
  },
};

/**
 * 32 Automatic SoC. Connect the car so the battery isn't typed in by hand.
 * The screen is strict about wording: a number is only "from your car" when the
 * stored reading says so (battery.source === 'vehicle') and the link is up.
 */
export default function AutoSocScreen(): React.JSX.Element {
  const nav = useNavigation();
  const {vehicle: vehicleService} = useServices();
  const link = useApp(s => s.vehicleLink);
  const battery = useApp(s => s.battery);
  const allowed = useApp(s => s.privacy.vehicleBatteryData);
  const vehicle = useApp(s => s.vehicles.find(v => v.id === s.activeVehicleId));
  const now = useNow();

  const [method, setMethod] = useState<Method>(link.method ?? 'oem');
  const [phase, setPhase] = useState<'idle' | 'connecting' | 'disconnecting'>(
    'idle',
  );
  const [error, setError] = useState<ErrorCopy | null>(null);

  const connecting = phase === 'connecting';
  const activeMethod: Method =
    link.connected && link.method ? link.method : method;
  const source = describeSocSource(link, battery, now);

  const connect = async () => {
    setPhase('connecting');
    setError(null);
    try {
      // TODO(integration): real OEM account sign-in / Bluetooth OBD pairing.
      await vehicleService.connectVehicle(method);
      showToast(`Connected through ${METHODS[method].title}.`, 'success');
    } catch (e) {
      setError(describeError(e, 'We couldn’t reach your car.'));
    } finally {
      setPhase('idle');
    }
  };

  const disconnect = async () => {
    setPhase('disconnecting');
    setError(null);
    try {
      await vehicleService.disconnectVehicle();
      showToast('Disconnected. You can enter your battery by hand.', 'info');
    } catch (e) {
      setError(describeError(e, 'We couldn’t disconnect.'));
    } finally {
      setPhase('idle');
    }
  };

  const status = connecting
    ? {
        icon: null,
        title: 'Connecting…',
        sub: METHODS[method].connecting,
      }
    : link.connected
    ? {
        icon: 'circle-check' as IconName,
        title: 'Connected',
        sub: `Through ${METHODS[activeMethod].title}${
          vehicle ? ` • ${vehicle.make} ${vehicle.model}` : ''
        }`,
      }
    : {
        icon: 'link' as IconName,
        title: 'Not connected',
        sub: 'Your battery level is entered by hand.',
      };

  return (
    <Screen
      title="Automatic SoC"
      footer={
        link.connected ? (
          <>
            <PrimaryButton
              label="Refresh reading"
              icon="refresh-cw"
              loading={connecting}
              disabled={!allowed || phase === 'disconnecting'}
              onPress={connect}
            />
            <SecondaryButton
              label="Disconnect"
              tone="danger"
              loading={phase === 'disconnecting'}
              disabled={connecting}
              onPress={disconnect}
            />
          </>
        ) : (
          <PrimaryButton
            label={
              error ? 'Try again' : `Connect with ${METHODS[method].title}`
            }
            icon="link"
            loading={connecting}
            disabled={!allowed}
            onPress={connect}
          />
        )
      }>
      <Text style={styles.heading} accessibilityRole="header">
        Connect your vehicle
      </Text>
      <Text style={styles.lead}>
        Let PlugOrbit read your battery level so range and charge estimates
        start from the real number.
      </Text>

      <View style={styles.block}>
        <Card tone="dark">
          <View style={styles.statusRow}>
            <View style={styles.statusTile}>
              {status.icon ? (
                <Icon
                  name={status.icon}
                  size={22}
                  color={link.connected ? colors.lime : colors.placeholder}
                />
              ) : (
                <ActivityIndicator color={colors.lime} />
              )}
            </View>
            <View style={styles.statusText}>
              <Text style={styles.statusTitle}>{status.title}</Text>
              <Text style={styles.statusSub}>{status.sub}</Text>
            </View>
          </View>
          {source && (
            <View style={styles.reading}>
              <View style={styles.readingTop}>
                <Text style={styles.readingValue}>{battery?.percent}%</Text>
                <Pill label={source.label} tone={source.tone} />
              </View>
              <Text style={styles.readingDetail}>{source.detail}</Text>
            </View>
          )}
        </Card>
      </View>

      {!allowed && (
        <View style={styles.block}>
          <Notice
            tone="warn"
            title="Vehicle battery data is turned off"
            body="Turn it on in Privacy & data to connect your car. Until then your battery stays manual."
            action={
              <View style={styles.noticeAction}>
                <TextButton
                  label="Open Privacy & data"
                  icon="shield-check"
                  onPress={() => nav.navigate('Privacy')}
                />
              </View>
            }
          />
        </View>
      )}

      {error && (
        <View style={styles.block}>
          <Notice
            tone={errorTone(error)}
            title="Couldn’t connect to your car"
            body={error.body}
          />
        </View>
      )}

      <SectionTitle title="How to connect" />
      <View style={styles.methods}>
        {(Object.keys(METHODS) as Method[]).map(m => (
          <ChoiceCard
            key={m}
            icon={METHODS[m].icon}
            title={METHODS[m].title}
            body={METHODS[m].body}
            selected={activeMethod === m}
            disabled={connecting || link.connected}
            onPress={() => setMethod(m)}
          />
        ))}
      </View>

      <SectionTitle title="What we read" />
      <ListCard>
        <ExplainRow
          icon="battery-charging"
          tone="lime"
          title="Battery level"
          body="The state of charge, so range and charge-time estimates are based on the real number."
        />
        <ExplainRow
          icon="eye-off"
          title="Nothing else"
          body="Not your location, trips, driving habits or doors and locks."
        />
        <ListRow
          icon="shield-check"
          iconTone="info"
          title="Permission control"
          subtitle="Choose what PlugOrbit may read from your car"
          onPress={() => nav.navigate('Privacy')}
          last
        />
      </ListCard>

      <View style={styles.block}>
        <Notice
          tone="info"
          title="Demo build"
          body="Connecting here is simulated and returns a sample reading. Real OEM and OBD links need a vehicle-data partner."
        />
      </View>

      <View style={styles.block}>
        <ListCard>
          <ListRow
            icon="pencil"
            title="Enter battery by hand"
            subtitle="Always available if your car can’t connect"
            onPress={() => nav.navigate('ManualSoc')}
            last
          />
        </ListCard>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {...type.display, color: colors.ink},
  lead: {...type.body, color: colors.muted, marginTop: spacing.xs},
  block: {marginTop: spacing.lg},
  methods: {gap: spacing.md},
  noticeAction: {alignSelf: 'flex-start', marginTop: spacing.xs},
  statusRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  statusTile: {
    width: 48,
    height: 48,
    borderRadius: radii.md,
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusText: {flex: 1},
  statusTitle: {...type.heading, color: '#FFFFFF'},
  statusSub: {...type.caption, color: colors.chipText, marginTop: 2},
  reading: {
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.chipBorder,
  },
  readingTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  readingValue: {...type.display, color: '#FFFFFF'},
  readingDetail: {
    ...type.caption,
    color: colors.chipText,
    marginTop: spacing.sm,
    lineHeight: 18,
  },
});
