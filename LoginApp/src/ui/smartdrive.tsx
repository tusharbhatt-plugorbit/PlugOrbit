import React, {useEffect, useRef} from 'react';
import {Animated, Pressable, StyleSheet, Text, View} from 'react-native';
import {availabilityHeadline} from '../domain/rules';
import type {Vehicle} from '../domain/types';
import {
  CHARGE_CONFIDENCE_LABEL,
  VIOLATION_WORDS,
  costLabel,
  kmLabel,
  minutesLabel,
  pctLabel,
  topReasons,
} from '../intelligence/copy';
import {summariseRuledOut} from '../intelligence/chargingPlan';
import type {CopilotStatus} from '../intelligence/status';
import type {
  ActiveTrip,
  BackupStop,
  ChargeConfidence,
  LogEntry,
  RouteRisk,
  ScoredStop,
  StopMetrics,
} from '../intelligence/types';
import {colors, elevation, radii, spacing, type} from '../theme';
import {formatClock} from '../utils/format';
import {ConfidenceBadge, Pill} from './Badges';
import {Card, KeyValue} from './Card';
import {Icon, IconName} from './Icon';
import {TextButton} from './Buttons';

/* ---------------------------------------------------------------- headline -- */

const TONE_ICON: Record<CopilotStatus['tone'], IconName> = {
  good: 'circle-check',
  watch: 'eye',
  alert: 'triangle-alert',
};

/**
 * The first thing the driver sees: one calm sentence. Dark and lime when all is
 * well (the same card as the Trips hero), amber when something is coming up, and
 * the standard soft-red card only when it has to be.
 */
export function CopilotStatusCard({
  status,
  kicker = 'Smart Drive',
  footer,
}: {
  status: CopilotStatus;
  kicker?: string;
  footer?: React.ReactNode;
}) {
  const alert = status.tone === 'alert';
  const accent =
    status.tone === 'good'
      ? colors.lime
      : status.tone === 'watch'
      ? colors.amberOnDark
      : colors.danger;
  return (
    <Card tone={alert ? 'danger' : 'dark'}>
      <View style={styles.statusHead}>
        <Icon name={TONE_ICON[status.tone]} size={18} color={accent} />
        <Text style={[styles.kicker, {color: accent}]}>{kicker}</Text>
      </View>
      <Text
        style={[styles.statusHeadline, alert && styles.onLight]}
        accessibilityRole="header">
        {status.headline}
      </Text>
      <Text style={[styles.statusDetail, alert && styles.onLightSoft]}>
        {status.detail}
      </Text>
      {footer}
    </Card>
  );
}

/** Home's slim co-pilot line: status and a way in, over the map. */
export function CopilotStrip({
  status,
  onPress,
  actionLabel,
}: {
  status: CopilotStatus;
  onPress: () => void;
  actionLabel: string;
}) {
  const accent =
    status.tone === 'good'
      ? colors.lime
      : status.tone === 'watch'
      ? colors.amberOnDark
      : '#FFFFFF';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${status.headline} ${status.detail} ${actionLabel}`}
      testID="copilot-strip"
      style={({pressed}) => [
        styles.strip,
        status.tone === 'alert' && styles.stripAlert,
        pressed && styles.pressed,
      ]}>
      <View style={styles.stripIcon}>
        <Icon name={TONE_ICON[status.tone]} size={20} color={accent} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.stripHeadline} numberOfLines={2}>
          {status.headline}
        </Text>
        <Text style={styles.stripDetail} numberOfLines={2}>
          {status.detail}
        </Text>
      </View>
      <View style={styles.stripAction}>
        <Icon name="arrow-right" size={20} color={colors.ink} />
      </View>
    </Pressable>
  );
}

/* ------------------------------------------------------------ the journey -- */

type Mark = {
  at: number;
  label: string;
  kind: 'start' | 'stop' | 'backup' | 'end';
};

/**
 * The route as one line, with the battery you'll have at each point. It is the
 * picture of "PlugOrbit has it handled": where you are, the one stop, the backup,
 * and what's left when you get there.
 */
export function JourneyBar({trip}: {trip: ActiveTrip}) {
  const total = trip.totalKm || 1;
  const pct = (km: number) => Math.max(0, Math.min(100, (km / total) * 100));
  const here = pct(trip.progressKm);
  const {plan} = trip;
  // A stop right at the start has its own "arrive → leave" label; a start label
  // on top of it would just be a smudge.
  const stopNearStart = plan.primary !== null && pct(plan.primary.alongKm) < 25;
  const marks: Mark[] = stopNearStart
    ? []
    : [{at: 0, kind: 'start', label: pctLabel(trip.startSoC)}];
  if (plan.primary) {
    marks.push({
      at: pct(plan.primary.alongKm),
      kind: 'stop',
      label: `${pctLabel(plan.primary.metrics.arriveSoc.expected)} → ${pctLabel(
        plan.primary.metrics.targetSoc,
      )}`,
    });
  }
  const arrival = plan.destination.socWithPlan;
  const finishLabel = arrival
    ? `Arrive ~${pctLabel(arrival.expected)}`
    : plan.primary
    ? 'More stops ahead'
    : 'Can’t finish yet';
  marks.push({at: 100, kind: 'end', label: finishLabel});

  const a11y = [
    `Journey ${trip.origin.label} to ${trip.destination.label}.`,
    `${pctLabel(trip.currentSoC)} battery now, ${Math.round(
      trip.progressKm,
    )} of ${Math.round(total)} kilometres done.`,
    plan.primary
      ? `Charging stop at ${plan.primary.station.name}, ${kmLabel(
          Math.max(0, plan.primary.alongKm - trip.progressKm),
        )} ahead.`
      : 'No charging stop needed.',
  ].join(' ');

  return (
    <View style={styles.journey} accessible accessibilityLabel={a11y}>
      <View style={styles.markRow}>
        {marks.map(m => (
          <Text
            key={`${m.kind}-${m.at}`}
            style={[
              styles.markLabel,
              m.kind === 'stop' && styles.markLabelStop,
              // The last label hangs off the right edge, not past it.
              m.kind === 'end'
                ? styles.markLabelEnd
                : {left: `${Math.min(70, Math.max(0, m.at))}%`},
            ]}
            numberOfLines={1}>
            {m.label}
          </Text>
        ))}
      </View>
      <View style={styles.track}>
        <View style={[styles.trackDone, {width: `${here}%`}]} />
        {plan.backup && (
          <View
            style={[
              styles.dot,
              styles.dotBackup,
              {left: `${pct(plan.backup.alongKm)}%`},
            ]}
          />
        )}
        {plan.primary && (
          <View
            style={[
              styles.dot,
              styles.dotStop,
              {left: `${pct(plan.primary.alongKm)}%`},
            ]}
          />
        )}
        <View style={[styles.car, {left: `${here}%`}]}>
          <Icon name="car" size={14} color={colors.ink} />
        </View>
      </View>
      <View style={styles.legend}>
        <Text style={styles.legendText}>{trip.origin.label}</Text>
        <Text style={styles.legendText}>{trip.destination.label}</Text>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------ stop details -- */

export function ChargeConfidencePill({level}: {level: ChargeConfidence}) {
  return (
    <Pill
      label={CHARGE_CONFIDENCE_LABEL[level]}
      tone={level === 'high' ? 'lime' : level === 'medium' ? 'info' : 'amber'}
      icon={level === 'low' ? 'triangle-alert' : 'shield-check'}
    />
  );
}

export function RiskPill({risk}: {risk: RouteRisk}) {
  const copy: Record<
    RouteRisk,
    {label: string; tone: 'lime' | 'info' | 'amber'}
  > = {
    low: {label: 'Well covered', tone: 'lime'},
    medium: {label: 'Watching closely', tone: 'info'},
    high: {label: 'Thin on options', tone: 'amber'},
  };
  return <Pill label={copy[risk].label} tone={copy[risk].tone} />;
}

/**
 * The recommendation card, in the order a driver reads it: which charger, why
 * it is trusted, whether it is free, what it means for THIS car, what it costs
 * and what it does to the trip, and the backup.
 */
export function StopSummaryCard({
  stop,
  backup,
  vehicle,
  now,
  action,
  onPress,
}: {
  stop: ScoredStop;
  backup: BackupStop | null;
  vehicle: Vehicle | null;
  now: number;
  action?: React.ReactNode;
  onPress?: () => void;
}) {
  const m = stop.metrics;
  return (
    <Card
      tone="lime"
      onPress={onPress}
      accessibilityLabel={`Charging stop ${stop.station.name}`}>
      <View style={styles.pickRow}>
        <Pill label="PlugOrbit pick" tone="dark" icon="sparkles" uppercase />
        <ChargeConfidencePill level={stop.chargeConfidence} />
      </View>
      <Text style={styles.stopName}>{stop.station.name}</Text>
      <Text style={styles.stopAvail}>
        {availabilityHeadline(stop.station, vehicle, now)}
      </Text>
      <View style={styles.badgeRow}>
        <ConfidenceBadge
          feed={stop.station.statusFeed}
          now={now}
          subject="Status"
        />
      </View>

      <View style={styles.forCar}>
        <Text style={styles.forCarLine}>
          {m.connectorType === 'Type2' ? 'Type 2' : m.connectorType} •{' '}
          {m.chargerKw} kW charger
        </Text>
        <Text style={styles.forCarStrong}>
          For your car: ~{m.expectedKw} kW on average
        </Text>
        <Text style={styles.forCarLine}>
          {pctLabel(m.arriveSoc.expected)} → {pctLabel(m.targetSoc)}:{' '}
          {minutesLabel(m.chargeMinutes)}
        </Text>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statCell}>
          <Text style={styles.statValue}>{costLabel(m.cost)}</Text>
          <Text style={styles.statLabel}>Expected cost</Text>
        </View>
        <View style={styles.statCell}>
          <Text style={styles.statValue}>{minutesLabel(m.totalStopMin)}</Text>
          <Text style={styles.statLabel}>Total trip impact</Text>
        </View>
      </View>

      <Text style={styles.backupLine}>
        {backup
          ? `Backup: ${backup.station.name} ✓`
          : 'No backup nearby, so we’re watching this one closely.'}
      </Text>
      {action}
    </Card>
  );
}

/** Detour + wait + charge + back to route = the whole cost in minutes. */
export function StopBreakdown({metrics}: {metrics: StopMetrics}) {
  const w = metrics.wait;
  const waitText =
    w.basis === 'none'
      ? 'Unknown'
      : w.maxMinutes === 0
      ? 'None expected'
      : `~${w.minMinutes}-${w.maxMinutes} min`;
  return (
    <Card>
      <KeyValue label="Detour" value={`${metrics.detourMin} min`} />
      <KeyValue label="Expected wait" value={waitText} />
      <KeyValue label="Charging" value={minutesLabel(metrics.chargeMinutes)} />
      <KeyValue label="Back to route" value={`${metrics.rejoinMin} min`} />
      <KeyValue
        label="Total trip impact"
        value={minutesLabel(metrics.totalStopMin)}
        emphasis
        last
      />
    </Card>
  );
}

export function CostBreakdown({metrics}: {metrics: StopMetrics}) {
  const c = metrics.cost;
  const inr = (n: number | null) => (n === null ? 'Not published' : `₹${n}`);
  return (
    <Card>
      <KeyValue label="Energy" value={inr(c.energyInr)} />
      <KeyValue label="Parking" value={inr(c.parkingInr)} />
      <KeyValue label="Platform fee" value={`₹${c.platformInr}`} />
      <KeyValue label="Tax (GST)" value={inr(c.taxInr)} />
      <KeyValue label="Estimated stop" value={costLabel(c)} emphasis last />
    </Card>
  );
}

/** "Why this charger?" in the driver's words, never the codes. */
export function ReasonList({stop}: {stop: ScoredStop}) {
  const reasons = topReasons(stop.reasons, 5);
  return (
    <Card>
      {reasons.map(r => (
        <View key={r} style={styles.reasonRow}>
          <Icon name="check" size={16} color={colors.limeDark} />
          <Text style={styles.reasonText}>{r}</Text>
        </View>
      ))}
    </Card>
  );
}

/** What it compared and what it set aside, so the choice is never a black box. */
export function RuledOutNote({trip}: {trip: ActiveTrip}) {
  const {plan} = trip;
  const groups = summariseRuledOut(plan.ruledOut).slice(0, 3);
  if (plan.considered === 0) {
    return null;
  }
  return (
    <Text style={styles.fine}>
      Compared {plan.considered} chargers near your route.
      {groups.length > 0
        ? ` Set aside ${plan.ruledOut.length}: ${groups
            .map(g => `${g.count} ${VIOLATION_WORDS[g.code]}`)
            .join(', ')}.`
        : ''}
      {plan.tooEarly.length > 0
        ? ` ${plan.tooEarly.length} more were safe but too early to be worth stopping at.`
        : ''}
    </Text>
  );
}

/* --------------------------------------------------------------- the ledger -- */

const LOG_ICON: Record<LogEntry['kind'], IconName> = {
  checked: 'eye',
  silent: 'eye',
  notified: 'bell-ring',
  replanned: 'repeat',
};

/**
 * What PlugOrbit saw and chose to tell you or not. Silence is part of the
 * product, so it is shown: "checked 40 times, told you 3".
 */
export function CopilotLog({trip}: {trip: ActiveTrip}) {
  const items = [...trip.log].reverse().slice(0, 8);
  return (
    <Card>
      <Text style={styles.logTitle}>What PlugOrbit watched</Text>
      <Text style={styles.logSummary}>
        Checked {trip.counters.checks} time
        {trip.counters.checks === 1 ? '' : 's'} • told you {trip.counters.told}
        {trip.counters.told === 1 ? ' time' : ' times'}
      </Text>
      {items.map((l, i) => (
        <View key={`${l.at}-${i}`} style={styles.logRow}>
          <Icon
            name={LOG_ICON[l.kind]}
            size={15}
            color={l.kind === 'notified' ? colors.limeDark : colors.muted}
          />
          <Text style={styles.logText}>{l.text}</Text>
        </View>
      ))}
      <Text style={styles.fine}>
        Last checked {formatClock(trip.lastRecalculatedAt)}.
      </Text>
    </Card>
  );
}

/** The undo for a plan change, shown for as long as it is still an option. */
export function ChangeBanner({
  trip,
  onKeep,
}: {
  trip: ActiveTrip;
  onKeep: () => void;
}) {
  const c = trip.lastChange;
  if (!c || c.acknowledged || !trip.plan.primary) {
    return null;
  }
  return (
    <Card tone="lime">
      <View style={styles.statusHead}>
        <Icon name="repeat" size={16} color={colors.limeDark} />
        <Text style={[styles.kicker, {color: colors.limeDark}]}>
          Plan changed
        </Text>
      </View>
      <Text style={styles.changeText}>
        We moved your stop to {trip.plan.primary.station.name}
        {c.minutesSaved > 0 ? `, saving about ${c.minutesSaved} min` : ''}.
      </Text>
      {c.reason !== 'safety' && (
        <TextButton
          label={`Keep ${c.fromName}`}
          onPress={onKeep}
          tone="muted"
        />
      )}
    </Card>
  );
}

/** A small pulse so "monitoring" reads as alive without being noisy. */
export function MonitoringFooter({text}: {text: string}) {
  const pulse = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.4,
          duration: 900,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <View style={styles.monitor} accessible accessibilityLabel={text}>
      <Animated.View style={[styles.monitorDot, {opacity: pulse}]} />
      <Text style={styles.monitorText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  pressed: {opacity: 0.9},
  kicker: {...type.micro, textTransform: 'uppercase'},
  statusHead: {flexDirection: 'row', alignItems: 'center', gap: 6},
  statusHeadline: {...type.h1, color: '#FFFFFF', marginTop: spacing.sm},
  statusDetail: {
    ...type.body,
    color: colors.chipText,
    marginTop: 6,
    lineHeight: 20,
  },
  onLight: {color: colors.ink},
  onLightSoft: {color: colors.inkSoft},

  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.limeHaloBorder,
  },
  stripAlert: {borderColor: colors.danger},
  stripIcon: {width: 24, alignItems: 'center'},
  stripHeadline: {...type.heading, color: '#FFFFFF'},
  stripDetail: {...type.caption, color: colors.chipText, marginTop: 2},
  // The strip as a whole is the button; this just says "go".
  stripAction: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.lime,
  },

  journey: {paddingTop: spacing.sm},
  markRow: {height: 18, marginBottom: 6},
  markLabel: {
    position: 'absolute',
    ...type.micro,
    color: colors.inkSoft,
    letterSpacing: 0,
  },
  markLabelStop: {color: colors.limeDark},
  markLabelEnd: {right: 0},
  track: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.divider,
    justifyContent: 'center',
    marginHorizontal: 4,
  },
  trackDone: {height: 8, borderRadius: 4, backgroundColor: colors.lime},
  dot: {
    position: 'absolute',
    marginLeft: -7,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
  },
  dotStop: {backgroundColor: colors.bg, borderColor: colors.lime},
  dotBackup: {backgroundColor: colors.surface, borderColor: colors.muted},
  car: {
    position: 'absolute',
    marginLeft: -13,
    top: -10,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation(1),
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  legendText: {...type.caption, color: colors.muted},

  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 6,
  },
  stopName: {...type.h1, color: colors.ink, marginTop: spacing.md},
  stopAvail: {...type.bodyStrong, color: colors.inkSoft, marginTop: 4},
  badgeRow: {flexDirection: 'row', marginTop: spacing.sm},
  forCar: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    gap: 2,
  },
  forCarLine: {...type.caption, color: colors.inkSoft},
  forCarStrong: {...type.bodyStrong, color: colors.ink},
  statsRow: {flexDirection: 'row', gap: spacing.md, marginTop: spacing.md},
  statCell: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  statValue: {...type.heading, color: colors.ink},
  statLabel: {...type.caption, color: colors.muted, marginTop: 2},
  backupLine: {...type.label, color: colors.inkSoft, marginTop: spacing.md},

  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 32,
  },
  reasonText: {...type.body, color: colors.ink, flex: 1},
  fine: {...type.caption, color: colors.muted, marginTop: spacing.sm},

  logTitle: {...type.heading, color: colors.ink},
  logSummary: {
    ...type.caption,
    color: colors.muted,
    marginTop: 2,
    marginBottom: spacing.sm,
  },
  logRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    paddingVertical: 5,
  },
  logText: {...type.caption, color: colors.inkSoft, flex: 1, lineHeight: 18},

  changeText: {...type.body, color: colors.ink, marginTop: spacing.sm},

  monitor: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 32,
  },
  monitorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.limeDark,
  },
  monitorText: {...type.label, color: colors.inkSoft},
});
