import React from 'react';
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import {SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import {
  useNavigation,
  useNavigationState,
} from '../navigation/NavigationContext';
import {colors, radii, sizes, spacing, type} from '../theme';
import {Icon} from './Icon';
import {OfflineBanner} from './States';

const LOGO_MARK = require('../../assets/brand/logo-mark.png');

export function LogoTile() {
  return (
    <View style={styles.logoTile}>
      <Image
        source={LOGO_MARK}
        style={styles.logo}
        resizeMode="contain"
        accessibilityLabel="PlugOrbit"
      />
    </View>
  );
}

type Props = {
  title: string;
  /** Hide the back arrow (tab roots). Defaults to showing it when there is history. */
  hideBack?: boolean;
  onBack?: () => void;
  /** Right slot. Defaults to the PlugOrbit logo tile; pass `null` for nothing. */
  right?: React.ReactNode | null;
  /** Content on the dark header, under the title (search field, chips). */
  headerExtra?: React.ReactNode;
  children?: React.ReactNode;
  /** Wrap the body in a ScrollView (default true). */
  scroll?: boolean;
  /** Pinned action area under the body (primary CTA). */
  footer?: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
  /** Replace the light body colour (e.g. the dark scanner screen). */
  dark?: boolean;
  /** Space direct children evenly (12px). Saves wrapper views on simple screens. */
  stack?: boolean;
  testID?: string;
};

/**
 * The frame every screen shares: the approved Home look. A dark header with a
 * back arrow, centred title and logo tile, then a light rounded-top body.
 */
export function Screen({
  title,
  hideBack,
  onBack,
  right,
  headerExtra,
  children,
  scroll = true,
  footer,
  refreshing,
  onRefresh,
  contentStyle,
  dark = false,
  stack = false,
  testID,
}: Props) {
  const nav = useNavigation();
  const {depth} = useNavigationState();
  const insets = useSafeAreaInsets();
  const showBack = !hideBack && (onBack !== undefined || depth > 0);
  const tabBarVisible = depth === 0;

  const body = scroll ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[
        styles.content,
        footer ? styles.contentWithFooter : null,
        contentStyle,
      ]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={!!refreshing}
            onRefresh={onRefresh}
            tintColor={colors.limeDark}
          />
        ) : undefined
      }>
      <View style={[styles.column, stack && styles.stack]}>{children}</View>
    </ScrollView>
  ) : (
    <View style={[styles.flex, styles.content, contentStyle]}>
      <View style={[styles.column, styles.flex, stack && styles.stack]}>
        {children}
      </View>
    </View>
  );

  return (
    <SafeAreaView
      style={styles.safe}
      edges={['top', 'left', 'right']}
      testID={testID}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <View style={styles.side}>
          {showBack && (
            <Pressable
              onPress={onBack ?? nav.goBack}
              hitSlop={14}
              accessibilityRole="button"
              accessibilityLabel="Back"
              style={styles.backBtn}>
              <Icon name="arrow-left" size={22} color="#FFFFFF" />
            </Pressable>
          )}
        </View>
        <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
          {title}
        </Text>
        <View style={[styles.side, styles.sideRight]}>
          {right === undefined ? <LogoTile /> : right}
        </View>
      </View>
      {headerExtra}
      <View style={[styles.body, dark && styles.bodyDark]}>
        <OfflineBanner />
        {body}
        {footer && (
          <View
            style={[
              styles.footer,
              {
                paddingBottom: tabBarVisible
                  ? spacing.md
                  : Math.max(insets.bottom, spacing.md),
              },
            ]}>
            <View style={[styles.column, styles.footerColumn]}>{footer}</View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: colors.bg},
  flex: {flex: 1},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    minHeight: sizes.header + spacing.sm + spacing.lg,
  },
  side: {width: 44, height: 36, justifyContent: 'center'},
  sideRight: {alignItems: 'flex-end'},
  backBtn: {height: 36, justifyContent: 'center'},
  title: {flex: 1, textAlign: 'center', color: '#FFFFFF', ...type.title},
  logoTile: {
    width: 32,
    height: 32,
    borderRadius: 9,
    padding: 5,
    backgroundColor: '#FFFFFF',
  },
  logo: {width: '100%', height: '100%'},
  body: {
    flex: 1,
    backgroundColor: colors.body,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    overflow: 'hidden',
  },
  bodyDark: {backgroundColor: colors.bgRaised},
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  contentWithFooter: {paddingBottom: spacing.lg},
  column: {width: '100%', maxWidth: sizes.maxContent, alignSelf: 'center'},
  footerColumn: {gap: spacing.sm},
  stack: {gap: spacing.md},
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    backgroundColor: colors.body,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    gap: spacing.sm,
  },
});
