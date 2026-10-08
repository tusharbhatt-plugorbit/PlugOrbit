import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {ActiveTrip, PendingSwitch} from '../domain/activeTrip';
import {switchWhy} from '../domain/coDriver';
import {kmToDestination, kmToStop, tripProgress} from '../domain/tripEngine';
import type {DriverStatus} from '../domain/tripStatus';
import type {FeedInfo} from '../domain/types';
import {formatDistanceRound} from '../domain/wording';
import {colors, radii, spacing, type} from '../theme';
import {formatClock, formatInr} from '../utils/format';
import {ConfidenceBadge, Pill} from './Badges';
import {PrimaryButton, TextButton} from './Buttons';
import {Card} from './Card';
import {BatteryGauge, ChargeConfidenceBadge, StatusLine} from './coDriver';
import {Icon} from './Icon';
import {Notice} from './States';

function ProgressBar({value, onDark}: {value: number; onDark?: boolean}) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Trip ${Math.round(value * 100)} percent complete`}
      style={[styles.track, onDark ? styles.trackDark : styles.trackLight]}>
      <View
        style={[
          styles.trackFill,
          {width: `${Math.max(2, Math.min(100, value * 100))}%`},
          !onDark && {backgroundColor: colors.limeDark},
        ]}
      />
    </View>
  );
}

function Stat({
  value,
  label,
  testID,
}: {
  value: string;
  label: string;
  testID?: string;
}) {
  return (
    <View style={styles.stat} testID={testID}>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/** The journey at a glance: where to, when, and the battery the whole way. */
export function TripHero({
  trip,
  status,
  reservePct,
}: {
  trip: ActiveTrip;
  /** Null when the card below already says it (arrival, switch, charging). */
  status: DriverStatus | null;
  reservePct: number;
}) {
  const done = trip.phase === 'arrived' || trip.phase === 'ended';
  return (
    <Card tone="dark" testID="trip-hero">
      <View style={styles.heroTop}>
        <Text style={styles.heroKicker}>Smart Drive</Text>
        <Pill
          label={trip.smartDriveEnabled ? 'On' : 'Off'}
          tone={trip.smartDriveEnabled ? 'lime' : 'slate'}
          dot={trip.smartDriveEnabled}
          uppercase
        />
      </View>
      <Text style={styles.heroTitle} numberOfLines={1}>
        {trip.destination}
      </Text>
      <Text style={styles.heroSub}>
        {done
          ? 'You’ve arrived'
          : `ETA ${formatClock(trip.etaAt)} • ${formatDistanceRound(
              kmToDestination(trip),
            )} to go`}
      </Text>
      <View style={styles.heroBar}>
        <ProgressBar value={tripProgress(trip)} onDark />
      </View>

      <View style={styles.heroBattery}>
        <View>
          <Text style={styles.heroBig}>{trip.currentSoc}%</Text>
          <Text style={styles.heroCaption}>Battery now (estimated)</Text>
        </View>
        <View style={styles.heroRight}>
          <Text style={styles.heroMid}>~{trip.expectedArrivalSoc}%</Text>
          <Text style={styles.heroCaption}>Expected on arrival</Text>
        </View>
      </View>
      <BatteryGauge percent={trip.currentSoc} reservePct={reservePct} onDark />
      {status && (
        <View style={styles.heroStatus}>
          <StatusLine
            tone={status.tone}
            headline={status.headline}
            detail={status.detail}
            onDark
            testID="trip-status"
          />
        </View>
      )}
    </Card>
  );
}

/** The next charging decision, with its backup and the promise to keep watching. */
export function NextStopCard({
  trip,
  feed,
  now,
  bays,
}: {
  trip: ActiveTrip;
  /** The latest look at the station's status (or the saved one, offline). */
  feed: FeedInfo;
  now: number;
  /** Compatible bays free at the last look, so a full charger is never hidden. */
  bays?: {free: number | null; total: number};
}) {
  const stop = trip.primaryStop;
  if (!stop) {
    return (
      <Card tone="lime">
        <StatusLine
          tone="good"
          headline="No more charging needed"
          detail={`You have enough battery to reach ${trip.destination}.`}
        />
      </Card>
    );
  }
  const away = kmToStop(trip) ?? 0;
  const offline = trip.monitoringStatus === 'offline';
  return (
    <Card testID="next-stop">
      <View style={styles.stopHead}>
        <Text style={styles.kicker}>
          {trip.phase === 'at_charger' ? 'You’re here' : 'Next charging stop'}
        </Text>
        {trip.phase === 'driving' && (
          <Pill label={formatDistanceRound(away)} tone="slate" icon="map-pin" />
        )}
      </View>
      <Text style={styles.stopName}>{stop.stationName}</Text>
      <View style={styles.badges}>
        <ChargeConfidenceBadge level={stop.confidence} />
        <ConfidenceBadge feed={feed} now={now} subject="Status" />
        {bays && bays.free !== null && (
          <Pill
            label={
              bays.free === 0
                ? offline
                  ? 'No free bay when last seen'
                  : 'No free bay right now'
                : `${bays.free} / ${bays.total} ${
                    offline ? 'free when last seen' : 'available'
                  }`
            }
            tone={bays.free === 0 ? 'amber' : offline ? 'slate' : 'lime'}
            dot
          />
        )}
      </View>
      <View style={styles.stats}>
        <Stat
          value={`${stop.arriveSoc}%`}
          label="Expected arrival"
          testID="stop-arrive"
        />
        <Stat
          value={`${stop.chargeToSoc}%`}
          label="Charge to"
          testID="stop-target"
        />
        <Stat
          value={`~${stop.chargeMin} min`}
          label="Estimated stop"
          testID="stop-time"
        />
      </View>
      {stop.costInr !== null && (
        <Text style={styles.cost}>
          Estimated cost {formatInr(stop.costInr)}
        </Text>
      )}
      {stop.backup ? (
        <View style={styles.backup}>
          <Icon name="shield-check" size={18} color={colors.info} />
          <View style={styles.flex}>
            <Text style={styles.backupTitle}>Backup ready ✓</Text>
            <Text style={styles.backupSub} numberOfLines={1}>
              {stop.backup.stationName}
            </Text>
          </View>
        </View>
      ) : (
        <Notice
          tone="warn"
          title="No close backup for this stop"
          body={
            stop.backupNote ??
            'No compatible charger is close enough to be a backup, so we’re keeping watch on this one.'
          }
        />
      )}
      <View style={styles.monitor} accessibilityLiveRegion="polite">
        <View style={[styles.dot, offline && styles.dotOffline]} />
        <Text style={styles.monitorText}>
          {offline
            ? 'Offline: we’ll watch your charger again as soon as you have signal.'
            : trip.phase === 'driving'
            ? 'PlugOrbit is monitoring your charging stop.'
            : 'PlugOrbit is watching this charger until you plug in.'}
        </Text>
      </View>
    </Card>
  );
}

/** "We've found a better charging stop." with a one-tap way to take it. */
export function SwitchRouteCard({
  pending,
  busy,
  error,
  onSwitch,
  onStay,
}: {
  pending: PendingSwitch;
  busy?: boolean;
  error?: string | null;
  onSwitch: () => void;
  onStay: () => void;
}) {
  const ahead =
    pending.aheadKm !== null
      ? `${pending.toName} is ${formatDistanceRound(
          pending.aheadKm,
        )} ahead on your route.`
      : `${pending.toName} is a better option.`;
  return (
    <Card tone="warn" testID="switch-card">
      <View style={styles.switchHead}>
        <Icon name="repeat" size={18} color={colors.amber} />
        <Text style={styles.switchKicker}>Charging plan</Text>
      </View>
      <Text style={styles.switchTitle}>
        We’ve found a better charging stop.
      </Text>
      <Text style={styles.switchBody}>
        {switchWhy(pending.reason, pending.fromName)} {ahead}
      </Text>
      {pending.savedMin !== null && pending.savedMin > 0 && (
        <Text style={styles.switchSaves}>
          Saves about {pending.savedMin} min of waiting.
        </Text>
      )}
      {error ? (
        <View style={styles.switchError}>
          <Notice tone="danger" title="Couldn’t switch yet" body={error} />
        </View>
      ) : null}
      <PrimaryButton
        label="Switch route"
        icon="repeat"
        loading={busy}
        onPress={onSwitch}
        style={styles.switchCta}
        testID="switch-route"
      />
      <View style={styles.center}>
        <TextButton
          label={`Stay with ${pending.fromName}`}
          tone="muted"
          onPress={onStay}
        />
      </View>
    </Card>
  );
}

/** The compact version for Home and Trips: one calm line and a way in. */
export function ActiveTripCard({
  trip,
  status,
  onOpen,
}: {
  trip: ActiveTrip;
  status: DriverStatus;
  onOpen: () => void;
}) {
  return (
    <Card testID="active-trip-card">
      <View style={styles.stopHead}>
        <Pill
          label={trip.smartDriveEnabled ? 'Smart Drive on' : 'Smart Drive off'}
          tone={trip.smartDriveEnabled ? 'lime' : 'slate'}
          dot={trip.smartDriveEnabled}
        />
        <Text style={styles.cardDest} numberOfLines={1}>
          {trip.origin} → {trip.destination}
        </Text>
      </View>
      <View style={styles.cardStatus}>
        <StatusLine
          tone={status.tone}
          headline={status.headline}
          detail={status.detail}
        />
      </View>
      <ProgressBar value={tripProgress(trip)} />
      <PrimaryButton
        label="Open trip"
        icon="navigation"
        onPress={onOpen}
        style={styles.cardCta}
        testID="open-trip"
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  center: {alignItems: 'center', marginTop: spacing.xs},
  track: {height: 6, borderRadius: 3, overflow: 'hidden'},
  trackDark: {backgroundColor: colors.chipBorder},
  trackLight: {backgroundColor: colors.slateSoft},
  trackFill: {height: '100%', borderRadius: 3, backgroundColor: colors.lime},
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroKicker: {...type.micro, color: colors.lime, textTransform: 'uppercase'},
  heroTitle: {...type.display, color: '#FFFFFF', marginTop: spacing.sm},
  heroSub: {...type.body, color: colors.chipText, marginTop: 2},
  heroBar: {marginTop: spacing.md},
  heroBattery: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  heroRight: {alignItems: 'flex-end'},
  heroBig: {
    fontSize: 40,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -1,
  },
  heroMid: {...type.h1, color: '#FFFFFF'},
  heroCaption: {...type.caption, color: colors.chipText},
  heroStatus: {
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.chipBorder,
  },
  stopHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  kicker: {...type.micro, color: colors.limeDark, textTransform: 'uppercase'},
  stopName: {...type.h1, color: colors.ink, marginTop: 4},
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
  },
  stats: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  stat: {flex: 1},
  statValue: {...type.heading, color: colors.ink},
  statLabel: {
    ...type.caption,
    color: colors.muted,
    fontSize: 11.5,
    marginTop: 2,
  },
  cost: {...type.caption, color: colors.inkSoft, marginTop: spacing.sm},
  backup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.infoSoft,
  },
  backupTitle: {...type.bodyStrong, color: colors.info},
  backupSub: {...type.caption, color: colors.inkSoft, marginTop: 1},
  monitor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  dot: {width: 8, height: 8, borderRadius: 4, backgroundColor: colors.limeDark},
  dotOffline: {backgroundColor: colors.amber},
  monitorText: {...type.caption, color: colors.inkSoft, flex: 1},
  switchHead: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  switchKicker: {
    ...type.micro,
    color: colors.amber,
    textTransform: 'uppercase',
  },
  switchTitle: {...type.h1, color: colors.ink, marginTop: 6},
  switchBody: {
    ...type.body,
    color: colors.inkSoft,
    marginTop: 6,
    lineHeight: 20,
  },
  switchSaves: {...type.label, color: colors.ink, marginTop: spacing.sm},
  switchError: {marginTop: spacing.md},
  switchCta: {marginTop: spacing.lg},
  cardDest: {
    ...type.bodyStrong,
    color: colors.ink,
    flex: 1,
    textAlign: 'right',
  },
  cardStatus: {marginVertical: spacing.md},
  cardCta: {marginTop: spacing.md},
});
