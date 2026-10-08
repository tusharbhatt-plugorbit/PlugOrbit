import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {
  PaymentMethod,
  SessionSummary,
  Ticket,
  Vehicle,
} from '../domain/types';
import {colors, radii, spacing, type} from '../theme';
import {formatDate, formatInr} from '../utils/format';
import {Pill} from './Badges';
import {Card} from './Card';
import {Icon, IconName} from './Icon';

export function SessionMetricCard({
  label,
  value,
  unit,
  icon,
}: {
  label: string;
  value: string;
  unit?: string;
  icon?: IconName;
}) {
  return (
    <View
      style={styles.metric}
      accessible
      accessibilityLabel={`${label}: ${value}${unit ? ` ${unit}` : ''}`}>
      <View style={styles.metricHead}>
        {icon && <Icon name={icon} size={14} color={colors.muted} />}
        <Text style={styles.metricLabel}>{label}</Text>
      </View>
      <Text style={styles.metricValue}>
        {value}
        {unit ? <Text style={styles.metricUnit}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

const METHOD_ICON: Record<PaymentMethod['kind'], IconName> = {
  upi: 'smartphone',
  card: 'credit-card',
  wallet: 'wallet',
};

export function PaymentMethodCard({
  method,
  selected,
  onPress,
}: {
  method: PaymentMethod;
  selected?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{selected: !!selected, disabled: !onPress}}
      accessibilityLabel={`${method.label} ${method.detail}${
        method.validated ? '' : ', not verified'
      }`}
      style={[styles.method, selected && styles.methodSelected]}>
      <View style={styles.methodIcon}>
        <Icon name={METHOD_ICON[method.kind]} size={20} color={colors.ink} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.methodTitle}>
          {method.label}{' '}
          <Text style={styles.methodDetail}>{method.detail}</Text>
        </Text>
        <View style={styles.methodMeta}>
          {method.validated ? (
            <Pill label="Verified" tone="lime" icon="shield-check" />
          ) : (
            <Pill label="Not verified" tone="amber" icon="triangle-alert" />
          )}
          {method.isDefault && <Pill label="Default" tone="slate" />}
        </View>
      </View>
      <View style={[styles.radio, selected && styles.radioOn]}>
        {selected && (
          <Icon name="check" size={14} color={colors.ink} strokeWidth={3} />
        )}
      </View>
    </Pressable>
  );
}

const TICKET_STATUS = {
  open: {label: 'Open', tone: 'amber' as const},
  in_review: {label: 'In review', tone: 'info' as const},
  resolved: {label: 'Resolved', tone: 'lime' as const},
};

export function SupportTicketCard({
  ticket,
  onPress,
}: {
  ticket: Ticket;
  onPress?: () => void;
}) {
  const s = TICKET_STATUS[ticket.status];
  return (
    <Card
      onPress={onPress}
      accessibilityLabel={`Ticket ${ticket.number}, ${ticket.title}, ${s.label}`}>
      <View style={styles.ticketTop}>
        <Text style={styles.ticketNo}>#{ticket.number}</Text>
        <Pill label={s.label} tone={s.tone} uppercase />
      </View>
      <Text style={styles.ticketTitle} numberOfLines={2}>
        {ticket.title}
      </Text>
      <Text style={styles.ticketMeta}>
        {ticket.messages.length} message
        {ticket.messages.length === 1 ? '' : 's'} • updated{' '}
        {formatDate(ticket.updatedAt)}
      </Text>
    </Card>
  );
}

export function SessionRow({
  session,
  onPress,
}: {
  session: SessionSummary;
  onPress?: () => void;
}) {
  return (
    <Card
      onPress={onPress}
      accessibilityLabel={`${session.stationName}, ${formatInr(
        session.costInr,
      )}`}>
      <View style={styles.ticketTop}>
        <Text style={styles.sessionTitle} numberOfLines={1}>
          {session.stationName}
        </Text>
        <Icon name="chevron-right" size={18} color={colors.placeholder} />
      </View>
      <Text style={styles.ticketMeta}>
        {formatDate(session.startedAt)} • {session.energyKwh.toFixed(1)} kWh •{' '}
        {session.durationMin} min
      </Text>
      <View style={styles.sessionFoot}>
        <Text style={styles.sessionCost}>
          {formatInr(session.costInr, true)}
        </Text>
        <Pill
          label={
            session.status === 'paid'
              ? 'Paid'
              : session.status === 'refunded'
              ? 'Refunded'
              : 'Payment due'
          }
          tone={
            session.status === 'paid'
              ? 'lime'
              : session.status === 'refunded'
              ? 'info'
              : 'amber'
          }
          uppercase
        />
      </View>
    </Card>
  );
}

export function vehicleName(v: Vehicle): string {
  return `${v.make} ${v.model}`;
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  metric: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    minWidth: 130,
  },
  metricHead: {flexDirection: 'row', alignItems: 'center', gap: 6},
  metricLabel: {...type.caption, color: colors.muted},
  metricValue: {...type.display, color: colors.ink, marginTop: 6},
  metricUnit: {...type.label, color: colors.muted},
  method: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  methodSelected: {borderColor: colors.bg, backgroundColor: colors.limeSoft},
  methodIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodTitle: {...type.bodyStrong, color: colors.ink},
  methodDetail: {...type.body, color: colors.muted},
  methodMeta: {flexDirection: 'row', gap: 6, marginTop: 6},
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.inputBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: {backgroundColor: colors.lime, borderColor: colors.lime},
  ticketTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  ticketNo: {...type.label, color: colors.muted},
  ticketTitle: {...type.heading, color: colors.ink, marginTop: 6},
  ticketMeta: {...type.caption, color: colors.muted, marginTop: 4},
  sessionTitle: {...type.heading, color: colors.ink, flex: 1},
  sessionFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  sessionCost: {...type.h1, color: colors.ink},
});
