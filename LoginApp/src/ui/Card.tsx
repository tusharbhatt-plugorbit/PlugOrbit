import React from 'react';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import {colors, elevation, radii, spacing, type} from '../theme';
import {Icon, IconName} from './Icon';

type CardProps = {
  children: React.ReactNode;
  /** Highlight (recommended/selected) uses the soft lime surface. */
  tone?: 'default' | 'lime' | 'dark' | 'warn' | 'danger';
  onPress?: () => void;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
};

const TONE: Record<NonNullable<CardProps['tone']>, ViewStyle> = {
  default: {backgroundColor: colors.surface},
  lime: {backgroundColor: colors.limeSoft},
  dark: {backgroundColor: colors.bg},
  warn: {backgroundColor: colors.amberSoft},
  danger: {backgroundColor: colors.dangerSoft},
};

export function Card({
  children,
  tone = 'default',
  onPress,
  padded = true,
  style,
  accessibilityLabel,
  testID,
}: CardProps) {
  const body = [
    styles.card,
    elevation(1),
    TONE[tone],
    padded && styles.padded,
    style,
  ];
  if (!onPress) {
    return (
      <View style={body} testID={testID}>
        {children}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={({pressed}) => [body, pressed && styles.pressed]}>
      {children}
    </Pressable>
  );
}

export function SectionTitle({
  title,
  action,
  compact = false,
}: {
  title: string;
  action?: React.ReactNode;
  /** No outer margins: the parent spaces the heading (a gapped column). */
  compact?: boolean;
}) {
  return (
    <View style={[styles.sectionRow, compact && styles.sectionRowCompact]}>
      <Text style={styles.section} accessibilityRole="header">
        {title}
      </Text>
      {action}
    </View>
  );
}

type RowProps = {
  title: string;
  subtitle?: string;
  icon?: IconName;
  /** Icon tile tint. */
  iconTone?: 'default' | 'lime' | 'warn' | 'danger' | 'info';
  right?: React.ReactNode;
  /** Show a chevron (default true when onPress is set). */
  chevron?: boolean;
  onPress?: () => void;
  testID?: string;
  last?: boolean;
};

const ICON_TONE = {
  default: {bg: '#F1F5F9', fg: colors.ink},
  lime: {bg: colors.limeSoft, fg: colors.limeDark},
  warn: {bg: colors.amberSoft, fg: colors.amber},
  danger: {bg: colors.dangerSoft, fg: colors.danger},
  info: {bg: colors.infoSoft, fg: colors.info},
} as const;

/** The "icon tile + title + subtitle + chevron" row used across Profile/Support/Activity. */
export function ListRow({
  title,
  subtitle,
  icon,
  iconTone = 'default',
  right,
  chevron,
  onPress,
  testID,
  last,
}: RowProps) {
  const tone = ICON_TONE[iconTone];
  const showChevron = chevron ?? !!onPress;
  const content = (
    <View style={[styles.row, !last && styles.rowDivider]}>
      {icon && (
        <View style={[styles.tile, {backgroundColor: tone.bg}]}>
          <Icon name={icon} size={20} color={tone.fg} />
        </View>
      )}
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSub} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {showChevron && (
        <Icon name="chevron-right" size={18} color={colors.placeholder} />
      )}
    </View>
  );
  if (!onPress) {
    return <View testID={testID}>{content}</View>;
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      testID={testID}
      android_ripple={{color: 'rgba(15,23,42,0.06)'}}
      style={({pressed}) => pressed && styles.pressed}>
      {content}
    </Pressable>
  );
}

/** Rows grouped in one white card. */
export function ListCard({children}: {children: React.ReactNode}) {
  return (
    <View style={[styles.card, elevation(1), styles.listCard]}>{children}</View>
  );
}

export function KeyValue({
  label,
  value,
  emphasis = false,
  last,
}: {
  label: string;
  value: React.ReactNode;
  emphasis?: boolean;
  last?: boolean;
}) {
  return (
    <View style={[styles.kv, !last && styles.rowDivider]}>
      <Text style={styles.kvLabel}>{label}</Text>
      {typeof value === 'string' || typeof value === 'number' ? (
        <Text style={[styles.kvValue, emphasis && styles.kvEmphasis]}>
          {value}
        </Text>
      ) : (
        value
      )}
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

export function Spacer({size = spacing.lg}: {size?: number}) {
  return <View style={{height: size}} />;
}

const styles = StyleSheet.create({
  card: {borderRadius: radii.lg, overflow: 'hidden'},
  padded: {padding: spacing.lg},
  pressed: {opacity: 0.88},
  listCard: {backgroundColor: colors.surface, paddingHorizontal: spacing.lg},
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  sectionRowCompact: {marginTop: 0, marginBottom: 0},
  section: {...type.heading, color: colors.ink},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 14,
    minHeight: 60,
  },
  rowDivider: {
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
  rowText: {flex: 1},
  rowTitle: {...type.bodyStrong, color: colors.ink},
  rowSub: {...type.caption, color: colors.muted, marginTop: 2},
  kv: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    gap: spacing.md,
  },
  kvLabel: {...type.body, color: colors.muted},
  kvValue: {
    ...type.bodyStrong,
    color: colors.ink,
    textAlign: 'right',
    flexShrink: 1,
  },
  kvEmphasis: {fontSize: 16, fontWeight: '800'},
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
    marginVertical: spacing.md,
  },
});
