import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {TripLogEntry} from '../domain/activeTrip';
import {BATTERY_CRITICAL_PCT} from '../domain/battery';
import {
  CONFIDENCE_HEADLINE,
  ChargeConfidence,
  ConfidenceReason,
} from '../domain/chargeConfidence';
import type {CostLine, StopCostBreakdown} from '../domain/costBreakdown';
import {costLines} from '../domain/costBreakdown';
import type {RouteConfidence} from '../domain/routeConfidence';
import type {StatusTone} from '../domain/tripStatus';
import {impactWaitLabel, TripImpact} from '../domain/tripImpact';
import type {VehicleChargeEstimate} from '../domain/vehicleCharging';
import {timeAgo} from '../domain/trust';
import type {Confidence} from '../domain/types';
import {colors, radii, spacing, type} from '../theme';
import {formatInr} from '../utils/format';
import {Pill} from './Badges';
import {Card} from './Card';
import {Icon, IconName} from './Icon';

// ------------------------------------------------------------------ the voice --

const STATUS_TONE: Record<
  StatusTone,
  {bg: string; fg: string; icon: IconName; onDark: string}
> = {
  good: {
    bg: colors.limeSoft,
    fg: colors.limeDark,
    icon: 'circle-check',
    onDark: colors.lime,
  },
  watch: {
    bg: colors.infoSoft,
    fg: colors.info,
    icon: 'info',
    onDark: colors.lime,
  },
  warn: {
    bg: colors.amberSoft,
    fg: colors.amber,
    icon: 'triangle-alert',
    onDark: colors.warnOnDark,
  },
  critical: {
    bg: colors.dangerSoft,
    fg: colors.danger,
    icon: 'circle-alert',
    onDark: colors.dangerOnDark,
  },
};

/**
 * The calm sentence that answers "what do I need to know right now?". Most of
 * the time it reassures ("You're good to drive."); it is the same component on
 * Home, the trip screen and the picks, so the voice never changes.
 */
export function StatusLine({
  tone,
  headline,
  detail,
  icon,
  onDark = false,
  testID,
}: {
  tone: StatusTone;
  headline: string;
  detail?: string;
  icon?: IconName;
  onDark?: boolean;
  testID?: string;
}) {
  const t = STATUS_TONE[tone];
  return (
    <View
      style={styles.statusRow}
      accessible
      accessibilityLabel={`${headline} ${detail ?? ''}`.trim()}
      testID={testID}>
      <View
        style={[
          styles.statusIcon,
          onDark ? styles.statusIconDark : {backgroundColor: t.bg},
        ]}>
        <Icon
          name={icon ?? t.icon}
          size={18}
          color={onDark ? t.onDark : t.fg}
          strokeWidth={2.4}
        />
      </View>
      <View style={styles.flex}>
        <Text style={[styles.statusHead, onDark && styles.onDarkHead]}>
          {headline}
        </Text>
        {detail ? (
          <Text style={[styles.statusDetail, onDark && styles.onDarkDetail]}>
            {detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// ------------------------------------------------------------------- battery --

/** A battery bar with the safety reserve marked, so "enough" is visible. */
export function BatteryGauge({
  percent,
  reservePct,
  onDark = false,
  height = 10,
}: {
  percent: number;
  reservePct?: number;
  onDark?: boolean;
  height?: number;
}) {
  const p = Math.max(0, Math.min(100, percent));
  const critical = p <= BATTERY_CRITICAL_PCT;
  const low = !critical && reservePct !== undefined && p <= reservePct + 8;
  const fill = critical
    ? onDark
      ? colors.dangerOnDark
      : colors.danger
    : low
    ? onDark
      ? colors.warnOnDark
      : colors.amber
    : onDark
    ? colors.lime
    : colors.limeDark;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Battery ${Math.round(p)} percent`}
      style={[
        styles.gauge,
        {height, borderRadius: height / 2},
        onDark ? styles.gaugeDark : styles.gaugeLight,
      ]}>
      <View
        style={[
          styles.gaugeFill,
          {width: `${p}%`, backgroundColor: fill, borderRadius: height / 2},
        ]}
      />
      {reservePct !== undefined && reservePct > 0 && reservePct < 100 && (
        <View
          style={[
            styles.reserveTick,
            {left: `${reservePct}%`, height: height + 6},
          ]}
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------- confidence --

const CONFIDENCE_TONE: Record<Confidence, 'lime' | 'info' | 'slate'> = {
  high: 'lime',
  medium: 'info',
  low: 'slate',
};

/** "High Charge Confidence". A level with reasons, never an invented percentage. */
export function ChargeConfidenceBadge({level}: {level: Confidence}) {
  return (
    <Pill
      label={CONFIDENCE_HEADLINE[level]}
      tone={CONFIDENCE_TONE[level]}
      icon="shield-check"
    />
  );
}

const REASON_ICON: Record<ConfidenceReason['tone'], IconName> = {
  good: 'circle-check',
  neutral: 'info',
  warn: 'triangle-alert',
};
const REASON_COLOR: Record<ConfidenceReason['tone'], string> = {
  good: colors.limeDark,
  neutral: colors.muted,
  warn: colors.amber,
};

export function ReasonList({
  reasons,
  testID,
}: {
  reasons: readonly ConfidenceReason[];
  testID?: string;
}) {
  return (
    <View style={styles.reasons} testID={testID}>
      {reasons.map(r => (
        <View key={r.text} style={styles.reasonRow}>
          <Icon
            name={REASON_ICON[r.tone]}
            size={15}
            color={REASON_COLOR[r.tone]}
          />
          <Text style={styles.reasonText}>{r.text}</Text>
        </View>
      ))}
    </View>
  );
}

export function ChargeConfidenceCard({
  confidence,
}: {
  confidence: ChargeConfidence;
}) {
  return (
    <Card>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>Charge Confidence</Text>
        <ChargeConfidenceBadge level={confidence.level} />
      </View>
      <Text style={styles.cardSub}>
        How sure we are that a charge here will simply work. It never includes
        whether a bay is free right now: that is shown separately.
      </Text>
      <ReasonList reasons={confidence.reasons} />
    </Card>
  );
}

export function RouteConfidenceCard({route}: {route: RouteConfidence}) {
  const tone = CONFIDENCE_TONE[route.level];
  return (
    <Card tone={route.level === 'high' ? 'lime' : 'default'}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>Route confidence</Text>
        <Pill label={route.label.toUpperCase()} tone={tone} icon="route" />
      </View>
      <Text style={styles.cardSub}>{route.headline}</Text>
      <ReasonList reasons={route.reasons} />
    </Card>
  );
}

// -------------------------------------------------------------- impact & cost --

function Row({
  label,
  value,
  strong,
  muted,
  last,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
  last?: boolean;
}) {
  return (
    <View style={[styles.row, !last && styles.rowDivider]}>
      <Text style={[styles.rowLabel, strong && styles.rowLabelStrong]}>
        {label}
      </Text>
      <Text
        style={[
          styles.rowValue,
          strong && styles.rowValueStrong,
          muted && styles.rowValueMuted,
        ]}>
        {value}
      </Text>
    </View>
  );
}

/**
 * What this charger does for THIS car: a 120 kW label is not 120 kW for a car
 * that tops out at 60. The technical number sits beside the one that matters.
 */
export function VehicleChargeCard({
  estimate,
  vehicleLabel,
}: {
  estimate: VehicleChargeEstimate;
  vehicleLabel: string;
}) {
  return (
    <Card testID="vehicle-charge-card">
      <Text style={styles.cardTitle}>On your {vehicleLabel}</Text>
      <View style={styles.rows}>
        <Row label="Charger capability" value={`${estimate.chargerKw} kW`} />
        <Row
          label="Expected for your car"
          value={
            estimate.canCharge
              ? `~${Math.round(estimate.avgKw)} kW`
              : 'Not compatible'
          }
        />
        {estimate.canCharge && (
          <Row
            label={`${Math.round(estimate.fromSoc)}% to ${Math.round(
              estimate.toSoc,
            )}%`}
            value={`~${estimate.minutes} min`}
            strong
            last
          />
        )}
      </View>
      {estimate.canCharge && estimate.limitedBy !== 'none' && (
        <Text style={styles.cardSub}>
          {estimate.limitedBy === 'car'
            ? 'Your car’s own limit sets the pace here, not this charger.'
            : 'This charger is slower than your car can take.'}
        </Text>
      )}
    </Card>
  );
}

/** Detour, likely wait and charging, then the total: the real cost in time. */
export function TripImpactCard({
  impact,
  title = 'Total trip impact',
}: {
  impact: TripImpact;
  title?: string;
}) {
  const total =
    impact.totalMinMinutes === impact.totalMaxMinutes
      ? `~${impact.totalMinMinutes} min`
      : `~${impact.totalMinMinutes}-${impact.totalMaxMinutes} min`;
  return (
    <Card>
      <Text style={styles.cardTitle}>{title}</Text>
      <View style={styles.rows}>
        <Row
          label="Detour"
          value={
            impact.detourMin <= 1 ? 'On your route' : `${impact.detourMin} min`
          }
        />
        <Row label="Likely wait" value={impactWaitLabel(impact)} />
        <Row label="Charging" value={`${impact.chargeMin} min`} />
        <Row
          label="Total"
          value={impact.waitKnown ? total : `${total} or more`}
          strong
          last
        />
      </View>
    </Card>
  );
}

export function CostBreakdownCard({
  cost,
  title = 'Estimated cost',
}: {
  cost: StopCostBreakdown;
  title?: string;
}) {
  const lines: CostLine[] = costLines(cost, n => formatInr(n, true));
  return (
    <Card>
      <Text style={styles.cardTitle}>{title}</Text>
      <View style={styles.rows}>
        {lines.map(l => (
          <Row key={l.label} label={l.label} value={l.value} muted={l.muted} />
        ))}
        {cost.totalInr !== null && (
          <Row
            label="Estimated total"
            value={formatInr(cost.totalInr)}
            strong
            last
          />
        )}
      </View>
    </Card>
  );
}

// ------------------------------------------------------------------ timeline --

const LEVEL_DOT: Record<TripLogEntry['level'], string> = {
  informational: colors.placeholder,
  action: colors.limeDark,
  important: colors.amber,
  critical: colors.danger,
};

/** "What PlugOrbit did": the quiet record that builds trust in the monitoring. */
export function TripTimeline({
  log,
  now,
  limit = 6,
}: {
  log: readonly TripLogEntry[];
  now: number;
  limit?: number;
}) {
  const shown = [...log].slice(-limit).reverse();
  if (shown.length === 0) {
    return null;
  }
  return (
    <Card>
      <Text style={styles.cardTitle}>What PlugOrbit did</Text>
      <View style={styles.timeline}>
        {shown.map((e, i) => (
          <View key={e.id} style={styles.tlRow}>
            <View style={styles.tlRail}>
              <View
                style={[styles.tlDot, {backgroundColor: LEVEL_DOT[e.level]}]}
              />
              {i < shown.length - 1 && <View style={styles.tlLine} />}
            </View>
            <View style={[styles.flex, styles.tlText]}>
              <Text style={styles.tlTitle}>{e.title}</Text>
              <Text style={styles.tlBody}>{e.body}</Text>
              <Text style={styles.tlTime}>{timeAgo(e.at, now)}</Text>
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  statusRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  statusIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusIconDark: {
    backgroundColor: colors.limeHalo,
    borderWidth: 1,
    borderColor: colors.limeHaloBorder,
  },
  statusHead: {...type.heading, color: colors.ink},
  statusDetail: {...type.caption, color: colors.inkSoft, marginTop: 2},
  onDarkHead: {color: '#FFFFFF'},
  onDarkDetail: {color: colors.chipText},
  gauge: {width: '100%', overflow: 'visible', justifyContent: 'center'},
  gaugeLight: {backgroundColor: colors.slateSoft},
  gaugeDark: {backgroundColor: colors.chipBorder},
  gaugeFill: {position: 'absolute', left: 0, top: 0, bottom: 0},
  reserveTick: {
    position: 'absolute',
    top: -3,
    width: 2,
    marginLeft: -1,
    borderRadius: 1,
    backgroundColor: colors.muted,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardTitle: {...type.heading, color: colors.ink},
  cardSub: {...type.caption, color: colors.muted, marginTop: 4, lineHeight: 18},
  reasons: {gap: spacing.sm, marginTop: spacing.md},
  reasonRow: {flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm},
  reasonText: {...type.caption, color: colors.inkSoft, flex: 1, lineHeight: 18},
  rows: {marginTop: spacing.sm},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    gap: spacing.md,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  rowLabel: {...type.body, color: colors.muted},
  rowLabelStrong: {...type.bodyStrong, color: colors.ink},
  rowValue: {
    ...type.bodyStrong,
    color: colors.ink,
    textAlign: 'right',
    flexShrink: 1,
  },
  rowValueStrong: {fontSize: 18, fontWeight: '800'},
  rowValueMuted: {color: colors.muted, fontWeight: '600'},
  timeline: {marginTop: spacing.md},
  tlRow: {flexDirection: 'row', gap: spacing.md},
  tlRail: {alignItems: 'center', width: 12},
  tlDot: {width: 10, height: 10, borderRadius: 5, marginTop: 5},
  tlLine: {
    flex: 1,
    width: 2,
    backgroundColor: colors.divider,
    marginTop: 4,
    borderRadius: radii.sm,
  },
  tlText: {paddingBottom: spacing.lg},
  tlTitle: {...type.bodyStrong, color: colors.ink},
  tlBody: {
    ...type.caption,
    color: colors.inkSoft,
    marginTop: 2,
    lineHeight: 18,
  },
  tlTime: {...type.caption, color: colors.muted, marginTop: 4, fontSize: 11.5},
});
