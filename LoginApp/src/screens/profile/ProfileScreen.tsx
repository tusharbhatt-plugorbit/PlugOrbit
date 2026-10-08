import React, {useMemo, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {AlertPreferences, RouteStrategy} from '../../domain/types';
import {useNavigation} from '../../navigation/NavigationContext';
import {
  appStore,
  flushAppStore,
  selectActiveVehicle,
  useApp,
} from '../../store/appStore';
import {colors, radii, spacing, type} from '../../theme';
import {formatInr} from '../../utils/format';
import {
  Card,
  Icon,
  ListCard,
  ListRow,
  Notice,
  Pill,
  Screen,
  SecondaryButton,
  SectionTitle,
  VehicleSelector,
} from '../../ui';
import {ConfirmActionSheet} from '../../ui/ConfirmActionSheet';

const STRATEGY: Record<RouteStrategy, string> = {
  fastest: 'Fastest',
  cheapest: 'Cheapest',
  reliable: 'Most reliable',
};

function alertsOn(a: AlertPreferences): number {
  return [
    a.started,
    a.reached80,
    a.ended,
    a.paymentDone,
    a.idleFeeWarning,
  ].filter(Boolean).length;
}

function Stat({value, label}: {value: string; label: string}) {
  return (
    <View
      style={styles.stat}
      accessible
      accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/**
 * Profile (tab root). A dark account card with the active vehicle, then grouped
 * rows that reach every settings screen, and a confirmed sign out.
 */
export default function ProfileScreen(): React.JSX.Element {
  const nav = useNavigation();
  const vehicle = useApp(selectActiveVehicle);
  const vehicleCount = useApp(s => s.vehicles.length);
  const history = useApp(s => s.history);
  const plus = useApp(s => s.plus);
  const defaultMethod = useApp(s => s.paymentMethods.find(m => m.isDefault));
  const methodCount = useApp(s => s.paymentMethods.length);
  const tripPrefs = useApp(s => s.tripPrefs);
  const alertPrefs = useApp(s => s.alertPrefs);
  const language = useApp(s => s.language);
  const unread = useApp(s => s.notifications.filter(n => !n.read).length);
  const favourites = useApp(s => s.favouriteStationIds.length);
  const savedRoutes = useApp(s => s.savedRoutes.length);
  const sessionOpen = useApp(s => s.session !== null);
  const [confirmOut, setConfirmOut] = useState(false);

  const totals = useMemo(
    () => ({
      sessions: history.length,
      kwh: history.reduce((sum, h) => sum + h.energyKwh, 0),
      spent: history.reduce((sum, h) => sum + h.costInr, 0),
    }),
    [history],
  );

  const signOut = () => {
    setConfirmOut(false);
    appStore.set({signedIn: false});
    flushAppStore();
  };

  return (
    <Screen title="Profile" hideBack>
      <Card tone="dark">
        <View style={styles.accountRow}>
          <View style={styles.avatar}>
            <Icon name="user" size={26} color={colors.ink} />
          </View>
          <View style={styles.accountText}>
            <Text style={styles.name}>PlugOrbit driver</Text>
            <Text style={styles.accountSub}>
              {totals.sessions === 0
                ? 'No charging sessions yet'
                : `${totals.sessions} charging session${
                    totals.sessions === 1 ? '' : 's'
                  }`}
            </Text>
          </View>
          {plus.active ? (
            <Pill label="Plus" tone="lime" icon="crown" uppercase />
          ) : (
            <Pill label="Free plan" tone="slate" />
          )}
        </View>

        <View style={styles.vehicleRow}>
          <VehicleSelector tone="dark" />
        </View>

        <View style={styles.stats}>
          <Stat value={String(totals.sessions)} label="Sessions" />
          <Stat value={`${totals.kwh.toFixed(1)} kWh`} label="Energy" />
          <Stat value={formatInr(totals.spent)} label="Spent" />
        </View>
      </Card>

      <SectionTitle title="My EV" />
      <ListCard>
        <ListRow
          icon="car"
          title="Vehicles"
          subtitle={
            vehicle
              ? `${vehicle.make} ${vehicle.model} active • ${vehicleCount} saved`
              : 'Add your EV to see chargers that fit'
          }
          onPress={() => nav.navigate('Vehicles')}
        />
        <ListRow
          icon="credit-card"
          title="Payment methods"
          subtitle={
            defaultMethod
              ? `${defaultMethod.label} ${defaultMethod.detail} is your default`
              : methodCount > 0
              ? `${methodCount} saved, none set as default`
              : 'Add UPI or a card to start chargers from the app'
          }
          onPress={() => nav.navigate('PaymentMethods')}
        />
        <ListRow
          icon="route"
          title="Trip preferences"
          subtitle={`Arrive with ${tripPrefs.minArrivalSocPct}% or more • ${
            STRATEGY[tripPrefs.strategy]
          }`}
          onPress={() => nav.navigate('TripPreferences')}
        />
        <ListRow
          icon="battery-charging"
          title="Alerts & Smart Drive"
          subtitle={`${alertsOn(alertPrefs)} of 5 charging alerts on`}
          onPress={() => nav.navigate('Alerts')}
        />
        <ListRow
          icon="bookmark"
          title="Saved"
          subtitle={`${favourites} station${
            favourites === 1 ? '' : 's'
          } • ${savedRoutes} route${savedRoutes === 1 ? '' : 's'}`}
          onPress={() => nav.navigate('Saved')}
          last
        />
      </ListCard>

      <SectionTitle title="Account" />
      <ListCard>
        <ListRow
          icon="crown"
          iconTone="lime"
          title="PlugOrbit Plus"
          subtitle={
            plus.active
              ? 'Active • manage your plan'
              : '₹49 / week • lower platform fee'
          }
          onPress={() => nav.navigate('Plus')}
        />
        <ListRow
          icon="bell"
          title="Notifications"
          subtitle={unread > 0 ? `${unread} unread` : 'You’re all caught up'}
          right={
            unread > 0 ? <Pill label={String(unread)} tone="dark" /> : undefined
          }
          onPress={() => nav.navigate('Notifications')}
        />
        <ListRow
          icon="languages"
          title="Language"
          subtitle={
            language === 'hi' ? 'Hindi (saved, not translated yet)' : 'English'
          }
          onPress={() => nav.navigate('Language')}
        />
        <ListRow
          icon="shield-check"
          title="Privacy & data"
          subtitle="Location, battery and history controls"
          onPress={() => nav.navigate('Privacy')}
          last
        />
      </ListCard>

      <SectionTitle title="Help" />
      <ListCard>
        <ListRow
          icon="headset"
          title="Support"
          subtitle="Tickets, charger problems, payments"
          onPress={() => nav.navigate('Support')}
        />
        <ListRow
          icon="life-buoy"
          iconTone="warn"
          title="Roadside assistance"
          subtitle="Towing and help when you’re stranded"
          onPress={() => nav.navigate('Roadside')}
        />
        <ListRow
          icon="settings"
          iconTone="info"
          title="Presenter tools"
          subtitle="Demo switches and shortcuts"
          right={<Pill label="Demo" tone="info" uppercase />}
          onPress={() => nav.navigate('PresenterTools')}
          last
        />
      </ListCard>

      <View style={styles.signOut}>
        <SecondaryButton
          label="Sign out"
          icon="log-out"
          tone="danger"
          onPress={() => setConfirmOut(true)}
        />
        <Text style={styles.version}>PlugOrbit prototype • demo data feed</Text>
      </View>

      <ConfirmActionSheet
        visible={confirmOut}
        title="Sign out of PlugOrbit?"
        icon="log-out"
        tone="danger"
        body="You’ll return to the welcome screen. Your vehicles, history and saved places stay on this device, and you can sign back in any time."
        confirmLabel="Sign out"
        cancelLabel="Stay signed in"
        onConfirm={signOut}
        onCancel={() => setConfirmOut(false)}>
        {sessionOpen && (
          <Notice
            tone="warn"
            title="A charging session is still open"
            body="Signing out doesn’t stop it. Sign back in to finish and pay."
          />
        )}
      </ConfirmActionSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  accountRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  avatar: {
    width: 52,
    height: 52,
    borderRadius: radii.lg,
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountText: {flex: 1},
  name: {...type.heading, color: '#FFFFFF'},
  accountSub: {...type.caption, color: colors.chipText, marginTop: 2},
  vehicleRow: {marginTop: spacing.lg},
  stats: {
    flexDirection: 'row',
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.chipBorder,
  },
  stat: {flex: 1},
  statValue: {...type.heading, color: '#FFFFFF'},
  statLabel: {...type.caption, color: colors.placeholder, marginTop: 2},
  signOut: {marginTop: spacing.xl, gap: spacing.md},
  version: {...type.caption, color: colors.muted, textAlign: 'center'},
});
