import React, {useEffect, useMemo, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {resumeSession} from '../../app/initialStack';
import {chargeConfidence} from '../../domain/chargeConfidence';
import {stopCostBreakdown} from '../../domain/costBreakdown';
import {describeError} from '../../domain/describeError';
import {kmToStop} from '../../domain/tripEngine';
import {timeAgo, dataTrust} from '../../domain/trust';
import {tripStatus} from '../../domain/tripStatus';
import type {FeedInfo, FeedSource} from '../../domain/types';
import {formatDuration, formatInr} from '../../utils/format';
import {useIsFocused, useNavigation} from '../../navigation/NavigationContext';
import {useServices} from '../../services';
import {openDirections} from '../../services/directions';
import {useApp} from '../../store/appStore';
import {demoStore, useDemo} from '../../store/demoStore';
import {colors, spacing} from '../../theme';
import {
  Card,
  ChargeConfidenceCard,
  CostBreakdownCard,
  EmptyState,
  KeyValue,
  ListCard,
  ListRow,
  NextStopCard,
  Notice,
  PrimaryButton,
  Screen,
  SecondaryButton,
  showToast,
  StatusLine,
  SwitchRouteCard,
  TextButton,
  ToggleRow,
  TripHero,
  TripImpactCard,
  TripTimeline,
  useNow,
} from '../../ui';
import {ConfirmActionSheet} from '../../ui/ConfirmActionSheet';

/**
 * Smart Drive: the trip as PlugOrbit sees it. One hero (where to, ETA, battery),
 * one answer to "what's next?", the backup, and a quiet record of what was done
 * for you. The driver does not need to keep reopening it: it speaks up only when
 * something needs a decision.
 */
export default function SmartDriveScreen(): React.JSX.Element {
  const nav = useNavigation();
  const focused = useIsFocused();
  const now = useNow(5000);
  const {trip: tripService} = useServices();
  const trip = useApp(s => s.activeTrip);
  const snapshot = useApp(s => s.offlineTrip);
  const prefs = useApp(s => s.tripPrefs);
  const smartDrive = useApp(s => s.smartDrivePrefs);
  const session = useApp(s => s.session);
  const demo = useDemo(s => s);

  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  // Look at the charger as soon as the driver opens the trip.
  const tripId = trip?.tripId;
  useEffect(() => {
    if (focused && tripId) {
      tripService.refresh().catch(() => undefined);
    }
  }, [focused, tripId, tripService]);

  const active = trip && trip.phase !== 'ended' ? trip : null;
  const offlineNow = active?.monitoringStatus === 'offline';
  const stop = active?.primaryStop ?? null;
  const routeStop =
    active && stop ? active.route.stops[active.stopIndex] : undefined;

  // The newest look at the planned charger: the last refresh, or the plan as
  // saved. Its age is shown and decides whether it can be called LIVE.
  const feed: FeedInfo = useMemo(() => {
    const saved = snapshot?.stops.find(
      s => s.role === 'primary' && s.stationId === stop?.stationId,
    );
    const seen: FeedInfo = saved
      ? {
          source: saved.statusSource as FeedSource,
          updatedAt: saved.statusUpdatedAt,
        }
      : routeStop?.station.statusFeed ?? {source: 'none', updatedAt: null};
    // Without signal nothing can be vouched for right now: whatever the
    // operator said last is shown as an estimate with its age, never as LIVE.
    return offlineNow && seen.source === 'operator_feed'
      ? {source: 'estimate', updatedAt: seen.updatedAt}
      : seen;
  }, [snapshot, stop?.stationId, routeStop, offlineNow]);

  const confidence = useMemo(
    () =>
      active && routeStop
        ? chargeConfidence(
            {...routeStop.station, statusFeed: feed},
            active.vehicle,
            now,
          )
        : null,
    [active, routeStop, feed, now],
  );
  const cost = useMemo(() => {
    if (!active || !stop || !routeStop) {
      return null;
    }
    const connector =
      routeStop.station.connectors.find(c => c.id === stop.connectorId) ??
      routeStop.station.connectors[0];
    return connector
      ? stopCostBreakdown({
          station: routeStop.station,
          connector,
          vehicle: active.vehicle,
          fromSoc: stop.arriveSoc,
          toSoc: stop.chargeToSoc,
        })
      : null;
  }, [active, stop, routeStop]);

  if (!active) {
    return (
      <Screen title="Smart Drive">
        <EmptyState
          icon="route"
          title="No trip in progress"
          body="Tell us where you’re going and we’ll handle the charging. You drive."
          primary={{
            label: 'Plan a trip',
            icon: 'route',
            onPress: () => nav.replace('RoutePlanner'),
          }}
          secondary={{
            label: 'Charge nearby',
            onPress: () => nav.replace('ChargePick', {mode: 'nearby'}),
          }}
        />
      </Screen>
    );
  }

  const status = tripStatus(active, smartDrive.remindKm);
  const offline = offlineNow;
  // When the card below already says it (an arrival, a switch to decide, a
  // charge in progress) the hero stays quiet instead of repeating it.
  const heroStatus =
    active.pendingSwitch ||
    active.phase === 'at_charger' ||
    active.phase === 'charging' ||
    active.phase === 'arrived'
      ? null
      : status;
  const savedPrimary = snapshot?.stops.find(s => s.role === 'primary');
  const busyHere =
    active.phase === 'at_charger' &&
    savedPrimary?.freeBays === 0 &&
    dataTrust(feed, now) === 'live';

  const switchRoute = async () => {
    setSwitching(true);
    setSwitchError(null);
    try {
      await tripService.acceptSwitch();
    } catch (e) {
      setSwitchError(describeError(e, 'We couldn’t switch your stop.').body);
    }
    setSwitching(false);
  };

  const openNav = async () => {
    if (stop) {
      nav.navigate('Navigation', {
        stationId: stop.stationId,
        stopIndex: stop.stopIndex,
      });
      return;
    }
    const end = active.route.polyline[active.route.polyline.length - 1];
    const ok = await openDirections({id: 'dest', ...end});
    if (!ok) {
      showToast('Couldn’t open Google Maps.', 'warn');
    }
  };

  const finish = async () => {
    await tripService.finish();
    setConfirmEnd(false);
    nav.reset('Home');
  };

  const footer = (() => {
    switch (active.phase) {
      case 'at_charger':
        return (
          <PrimaryButton
            label="Scan charger QR"
            icon="scan-line"
            onPress={() =>
              nav.navigate(
                'ScanQr',
                stop ? {stationId: stop.stationId} : undefined,
              )
            }
            testID="scan-qr"
          />
        );
      case 'charging':
        return (
          <PrimaryButton
            label="Open charging"
            icon="zap"
            onPress={() =>
              session ? resumeSession(nav) : nav.navigate('ActiveSession')
            }
          />
        );
      case 'arrived':
        return (
          <PrimaryButton
            label="Finish trip"
            icon="check"
            onPress={finish}
            testID="finish-trip"
          />
        );
      default:
        return (
          <PrimaryButton
            label={
              stop ? 'Open navigation' : `Navigate to ${active.destination}`
            }
            icon="navigation"
            onPress={openNav}
          />
        );
    }
  })();

  const last = active.log[active.log.length - 1];
  const justReady =
    active.phase === 'driving' &&
    last?.kind === 'ready_to_continue' &&
    now - last.at < 10 * 60_000;

  return (
    <Screen title="Smart Drive" stack footer={footer}>
      {offline && (
        <Notice
          tone="warn"
          icon="wifi-off"
          title="OFFLINE TRIP MODE"
          body={`You’re offline. We’ve kept your charging plan available. Last updated ${timeAgo(
            snapshot?.savedAt ?? active.lastCheckedAt ?? active.startedAt,
            now,
          )}.`}
          action={
            <TextButton
              label="Open saved plan"
              icon="wifi-off"
              onPress={() => nav.navigate('OfflineMode')}
            />
          }
        />
      )}

      <TripHero
        trip={active}
        status={heroStatus}
        reservePct={prefs.minArrivalSocPct}
      />

      {active.pendingSwitch && (
        <SwitchRouteCard
          pending={active.pendingSwitch}
          busy={switching}
          error={switchError}
          onSwitch={switchRoute}
          onStay={() => {
            setSwitchError(null);
            tripService.dismissSwitch().catch(() => undefined);
          }}
        />
      )}

      {justReady && (
        <Notice
          tone="lime"
          title="You’re ready to continue."
          body={`Battery ${active.currentSoc}%. That’s enough to ${
            stop ? 'reach your next stop' : 'comfortably complete your trip'
          }. No action needed.`}
        />
      )}

      {active.phase === 'at_charger' && stop && (
        <Card tone="lime" testID="arrival-card">
          <StatusLine
            tone={busyHere ? 'warn' : 'good'}
            headline={`You’re at ${stop.stationName}.`}
            detail={
              busyHere
                ? 'It looks busy right now. Your backup is ready if you’d rather not wait.'
                : `Use connector ${stop.connectorLabel}. Scan the QR on the charger to start.`
            }
          />
          <View style={styles.arrivalActions}>
            {busyHere && stop.backup && (
              <SecondaryButton
                label="Status differs? Use my backup"
                icon="repeat"
                onPress={() =>
                  nav.navigate('BackupAlert', {
                    stationId: stop.stationId,
                    stopIndex: stop.stopIndex,
                  })
                }
              />
            )}
            <TextButton
              label="Report a problem with this charger"
              icon="flag"
              tone="muted"
              onPress={() =>
                nav.navigate('ReportProblem', {stationId: stop.stationId})
              }
            />
          </View>
        </Card>
      )}

      {active.phase === 'charging' && stop && (
        <Card tone="lime" testID="charging-card">
          <StatusLine
            tone="good"
            headline={`Charging at ${stop.stationName}.`}
            detail={`Heading to ${stop.chargeToSoc}%, about ${stop.chargeMin} min. We’ll tell you when you have enough.`}
          />
        </Card>
      )}

      {active.phase === 'arrived' ? (
        <Card testID="arrival-summary">
          <StatusLine
            tone="good"
            headline={`You’ve arrived in ${active.destination}.`}
            detail={`You made it with about ${active.currentSoc}% left.`}
          />
          <View style={styles.summary}>
            <KeyValue
              label="Charging stops"
              value={String(active.stats.stopsCompleted)}
            />
            <KeyValue
              label="Energy added"
              value={`${active.stats.energyKwh.toFixed(1)} kWh`}
            />
            <KeyValue
              label="Time charging"
              value={formatDuration(active.stats.chargeMin)}
            />
            <KeyValue
              label="Charging cost"
              value={formatInr(active.stats.costInr)}
              last
            />
          </View>
        </Card>
      ) : (
        <NextStopCard
          trip={active}
          feed={feed}
          now={now}
          bays={
            savedPrimary
              ? {free: savedPrimary.freeBays, total: savedPrimary.totalBays}
              : undefined
          }
        />
      )}

      {stop && active.phase !== 'charging' && (
        <>
          <View style={styles.center}>
            <TextButton
              label={details ? 'Hide stop details' : 'Stop details'}
              icon={details ? 'chevron-up' : 'chevron-down'}
              onPress={() => setDetails(!details)}
            />
          </View>
          {details && (
            <>
              <TripImpactCard impact={stop.impact} title="Total stop time" />
              {cost && <CostBreakdownCard cost={cost} />}
              {confidence && <ChargeConfidenceCard confidence={confidence} />}
              {active.recommendationReason ? (
                <Notice
                  tone="info"
                  icon="sparkles"
                  title="Why this charger"
                  body={active.recommendationReason}
                />
              ) : null}
            </>
          )}
        </>
      )}

      <Card>
        <ToggleRow
          title="Smart Drive"
          subtitle="Let PlugOrbit manage charging decisions during your trip."
          value={active.smartDriveEnabled}
          onValueChange={v => {
            tripService.setSmartDrive(v).catch(() => undefined);
          }}
          last
        />
      </Card>

      <ListCard>
        <ListRow
          icon="battery-charging"
          title="Battery not right?"
          subtitle="Correct it and we’ll re-check your plan"
          onPress={() => nav.navigate('ManualSoc')}
        />
        <ListRow
          icon="wifi-off"
          iconTone="warn"
          title="Saved plan for dead zones"
          subtitle="Route, charger and backup, without signal"
          onPress={() => nav.navigate('OfflineMode')}
        />
        <ListRow
          icon="bell"
          title="Smart Drive alerts"
          subtitle="Choose what we tell you, and when"
          onPress={() => nav.navigate('Alerts')}
          last
        />
      </ListCard>

      <TripTimeline log={active.log} now={now} />

      <Card>
        <ToggleRow
          title="Demo controls"
          subtitle="For presenting: simulate the drive and the charger changing."
          value={demoOpen}
          onValueChange={setDemoOpen}
          last={!demoOpen}
        />
        {demoOpen && (
          <View style={styles.demo}>
            <ToggleRow
              title="Auto-drive"
              subtitle="The car moves along the route by itself."
              value={demo.autoDrive}
              onValueChange={v => demoStore.set({autoDrive: v})}
            />
            <View style={styles.demoButtons}>
              <SecondaryButton
                label="Drive 20 km"
                icon="navigation"
                compact
                onPress={() => {
                  tripService.advance(active.km + 20).catch(() => undefined);
                }}
              />
              {stop && (
                <SecondaryButton
                  label="Skip to the reminder"
                  icon="bell"
                  compact
                  onPress={() => {
                    const away = kmToStop(active) ?? 0;
                    const target = Math.max(
                      0,
                      away - (smartDrive.remindKm - 12),
                    );
                    tripService
                      .advance(active.km + Math.max(target, 0))
                      .catch(() => undefined);
                  }}
                />
              )}
              {stop && (
                <SecondaryButton
                  label="Drive to the charger"
                  icon="plug-zap"
                  compact
                  onPress={() => {
                    tripService.advance(stop.alongKm).catch(() => undefined);
                  }}
                />
              )}
              <SecondaryButton
                label="Make my charger occupied"
                icon="zap-off"
                compact
                onPress={() => {
                  // Off then on, so it re-targets the charger we are heading to.
                  demoStore.set({stationOccupied: false});
                  demoStore.set({stationOccupied: true});
                  tripService.refresh().catch(() => undefined);
                }}
              />
              <SecondaryButton
                label={demo.offline ? 'Back online' : 'Go offline'}
                icon={demo.offline ? 'wifi' : 'wifi-off'}
                compact
                onPress={() => {
                  demoStore.set({offline: !demo.offline});
                  tripService.refresh().catch(() => undefined);
                }}
              />
            </View>
          </View>
        )}
      </Card>

      {active.phase !== 'arrived' && (
        <View style={styles.center}>
          <TextButton
            label="End trip"
            icon="flag"
            tone="muted"
            onPress={() => setConfirmEnd(true)}
          />
        </View>
      )}

      <ConfirmActionSheet
        visible={confirmEnd}
        title="End this trip?"
        body="We’ll stop watching your charging stop. Any charging session you have open stays open."
        confirmLabel="End trip"
        cancelLabel="Keep going"
        tone="danger"
        icon="flag"
        onConfirm={finish}
        onCancel={() => setConfirmEnd(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {alignItems: 'center'},
  arrivalActions: {gap: spacing.sm, marginTop: spacing.lg},
  summary: {marginTop: spacing.md},
  demo: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  demoButtons: {gap: spacing.sm, marginTop: spacing.sm},
});
