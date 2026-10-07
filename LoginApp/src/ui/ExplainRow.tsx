import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {colors, spacing, type} from '../theme';
import {Icon, IconName} from './Icon';

const TONE = {
  default: {bg: '#F1F5F9', fg: colors.ink},
  lime: {bg: colors.limeSoft, fg: colors.limeDark},
  warn: {bg: colors.amberSoft, fg: colors.amber},
  info: {bg: colors.infoSoft, fg: colors.info},
} as const;

/**
 * An icon tile with a title and a full, unclamped explanation. ListRow clamps its
 * subtitle to two lines; use this inside a ListCard when the copy is the point
 * (privacy explanations, "what we read", benefits).
 */
export function ExplainRow({
  icon,
  title,
  body,
  tone = 'default',
  right,
  last,
}: {
  icon: IconName;
  title: string;
  body: string;
  tone?: keyof typeof TONE;
  /** A trailing pill or value. */
  right?: React.ReactNode;
  last?: boolean;
}) {
  const t = TONE[tone];
  return (
    <View
      style={[styles.row, !last && styles.divider]}
      accessible
      accessibilityLabel={`${title}. ${body}`}>
      <View style={[styles.tile, {backgroundColor: t.bg}]}>
        <Icon name={icon} size={20} color={t.fg} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: 14,
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  tile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {flex: 1},
  title: {...type.bodyStrong, color: colors.ink},
  body: {...type.caption, color: colors.muted, marginTop: 2, lineHeight: 18},
});
