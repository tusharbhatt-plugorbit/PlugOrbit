import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {ArrivalRisk} from '../domain/arrivalOutlook';
import {impactLabel, impactWaitLabel} from '../domain/tripImpact';
import type {ScoredCharger} from '../domain/recommendation';
import {capabilityLine} from '../domain/vehicleCharging';
import {colors, spacing, type} from '../theme';
import {formatInr} from '../utils/format';
import {formatDistance} from '../utils/geo';
import {ConfidenceBadge, Pill} from './Badges';
import {PrimaryButton, TextButton} from './Buttons';
import {Card} from './Card';
import {ChargeConfidenceBadge} from './coDriver';
import {Icon} from './Icon';

const RISK_TONE: Record<ArrivalRisk, 'lime' | 'info' | 'amber' | 'slate'> = {
  low: 'lime',
  medium: 'info',
  high: 'amber',
  unknown: 'slate',
};

function Fact({
  value,
  label,
  testID,
}: {
  value: string;
  label: string;
  testID?: string;
}) {
  return (
    <View style={styles.fact} testID={testID}>
      <Text style={styles.factValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.factLabel}>{label}</Text>
    </View>
  );
}

type Props = {
  pick: ScoredCharger;
  /** The backup charger, or null when none is close enough (we say so). */
  backup: {name: string} | null;
  backupExtraMin: number;
  now: number;
  /** Small label above the name. */
  kicker?: string;
  /** Names the number in the middle: "Trip impact" on a route, "Total time" nearby. */
  impactTitle?: string;
  ctaLabel?: string;
  onUse?: () => void;
  onDetails?: () => void;
  onBackup?: () => void;
  /** Replace the pick's own reasons (when the screen already said some). */
  reasons?: readonly string[];
  testID?: string;
};

/**
 * The PlugOrbit pick: the one charger to use, with everything a driver weighs
 * boiled down. Leads with confidence and live status, then the three numbers
 * that matter for THIS car (time, trip impact, cost), then the backup. The
 * technical detail is one line, for those who want it.
 */
export function ChargerPickCard({
  pick,
  backup,
  backupExtraMin,
  now,
  kicker = 'PlugOrbit pick',
  impactTitle = 'Trip impact',
  ctaLabel = 'Use this charger',
  onUse,
  onDetails,
  onBackup,
  reasons,
  testID,
}: Props) {
  const {station, connector, charge, arrival, cost, impact, confidence} = pick;
  const availability =
    arrival.freeNow === null
      ? 'Availability unknown'
      : `${arrival.freeNow} / ${arrival.total} available`;
  return (
    <Card tone="lime" testID={testID}>
      <Text style={styles.kicker}>{kicker}</Text>
      <Text style={styles.name} numberOfLines={2}>
        {station.name}
      </Text>
      <Text style={styles.sub}>
        {station.operator} • {formatDistance(pick.roadKm)} away
        {pick.open === null ? ' • hours unconfirmed' : ''}
      </Text>

      <View style={styles.badges}>
        <ChargeConfidenceBadge level={confidence.level} />
        <Pill label={availability} tone={RISK_TONE[arrival.risk]} dot />
        <ConfidenceBadge feed={station.statusFeed} now={now} subject="Status" />
      </View>
      {arrival.note ? (
        <View style={styles.noteRow}>
          <Icon name="clock" size={14} color={colors.amber} />
          <Text style={styles.note}>{arrival.note}</Text>
        </View>
      ) : null}

      <Text style={styles.connector}>
        {connector.type} • {connector.powerKw} kW
      </Text>
      <Text style={styles.capability}>{capabilityLine(charge)}</Text>

      <View style={styles.facts}>
        <Fact
          value={`~${charge.minutes} min`}
          label="Your expected charging"
          testID="pick-charging"
        />
        <Fact
          value={impactLabel(impact).replace(' or more', '+')}
          label={impactTitle}
          testID="pick-impact"
        />
        <Fact
          value={
            cost.totalInr === null ? 'Not published' : formatInr(cost.totalInr)
          }
          label="Estimated cost"
          testID="pick-cost"
        />
      </View>
      <Text style={styles.waitLine}>{impactWaitLabel(impact)}</Text>

      {(reasons ?? pick.reasons).length > 0 && (
        <View style={styles.reasons}>
          {(reasons ?? pick.reasons).map(r => (
            <View key={r} style={styles.reasonRow}>
              <Icon name="circle-check" size={15} color={colors.limeDark} />
              <Text style={styles.reasonText}>{r}</Text>
            </View>
          ))}
        </View>
      )}

      {backup ? (
        <Pressable
          onPress={onBackup}
          disabled={!onBackup}
          accessibilityRole="button"
          accessibilityLabel={`Backup ready: ${backup.name}, ${
            backupExtraMin > 0 ? `plus ${backupExtraMin} minutes` : 'same time'
          }`}
          style={({pressed}) => [styles.backup, pressed && styles.pressed]}>
          <Icon name="shield-check" size={18} color={colors.info} />
          <View style={styles.flex}>
            <Text style={styles.backupTitle}>Backup ready ✓</Text>
            <Text style={styles.backupSub} numberOfLines={1}>
              {backup.name}
              {backupExtraMin > 0
                ? ` • +${backupExtraMin} min`
                : ' • same time'}
            </Text>
          </View>
          {onBackup && (
            <Icon name="chevron-right" size={16} color={colors.placeholder} />
          )}
        </Pressable>
      ) : (
        <View style={styles.noBackup} accessibilityRole="alert">
          <Icon name="triangle-alert" size={16} color={colors.amber} />
          <Text style={styles.noBackupText}>
            No backup is close enough to rely on here, so we’ll keep watching
            this charger closely.
          </Text>
        </View>
      )}

      {onUse && (
        <PrimaryButton
          label={ctaLabel}
          icon="navigation"
          onPress={onUse}
          style={styles.cta}
          testID="pick-use"
        />
      )}
      {onDetails && (
        <View style={styles.center}>
          <TextButton
            label="Charger details"
            tone="muted"
            onPress={onDetails}
          />
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  kicker: {...type.micro, color: colors.limeDark, textTransform: 'uppercase'},
  name: {...type.h1, color: colors.ink, marginTop: 4},
  sub: {...type.caption, color: colors.inkSoft, marginTop: 2},
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: spacing.sm,
  },
  note: {...type.caption, color: colors.amber, flex: 1, lineHeight: 17},
  connector: {...type.bodyStrong, color: colors.ink, marginTop: spacing.md},
  capability: {...type.caption, color: colors.inkSoft, marginTop: 2},
  facts: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.limeHaloBorder,
  },
  fact: {flex: 1},
  factValue: {...type.heading, color: colors.ink},
  factLabel: {
    ...type.caption,
    color: colors.inkSoft,
    fontSize: 11.5,
    marginTop: 2,
  },
  waitLine: {...type.caption, color: colors.inkSoft, marginTop: spacing.sm},
  reasons: {gap: 6, marginTop: spacing.md},
  reasonRow: {flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm},
  reasonText: {...type.caption, color: colors.inkSoft, flex: 1, lineHeight: 18},
  backup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  pressed: {opacity: 0.88},
  backupTitle: {...type.bodyStrong, color: colors.info},
  backupSub: {...type.caption, color: colors.inkSoft, marginTop: 1},
  noBackup: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: 14,
    backgroundColor: colors.amberSoft,
  },
  noBackupText: {...type.caption, color: colors.amber, flex: 1, lineHeight: 18},
  cta: {marginTop: spacing.lg},
  center: {alignItems: 'center', marginTop: spacing.xs},
});
