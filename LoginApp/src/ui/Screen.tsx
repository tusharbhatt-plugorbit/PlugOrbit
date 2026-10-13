import {useAppearance, useThemedStyles} from '../appearance';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {KeyboardFocus} from './KeyboardFocus';
import {
  Keyboard,
  KeyboardAvoidingView,
  TextInput,
  Platform,
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
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import {
  useNavigation,
  useNavigationState,
} from '../navigation/NavigationContext';
import { colors, radii, sizes, spacing, type } from '../theme';
import { BrandLogo } from './BrandLogo';
import { Icon } from './Icon';
import { OfflineBanner } from './States';

/** The header's logo slot. */
export function LogoTile() {
  useAppearance();

  return <BrandLogo size={32} />;
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
  keepFooterWithKeyboard?: boolean;
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
  keepFooterWithKeyboard = false,
  refreshing,
  onRefresh,
  contentStyle,
  dark = false,
  stack = false,
  testID,
}: Props) {
  const {colors}=useAppearance();
  const styles=useThemedStyles(baseStyles);

  const nav = useNavigation();
  const appearance=useAppearance();
  const { depth, current: navStateCurrent } = useNavigationState();
  const insets = useSafeAreaInsets();
  const showBack = !hideBack && (onBack !== undefined || depth > 0);
  const tabBarVisible = depth === 0;

  const scrollRef = useRef<React.ElementRef<typeof ScrollView>>(null);
  const scrollOffset = useRef(0);
  const keyboardTop = useRef(Number.POSITIVE_INFINITY);
  const focusedInput = useRef<React.ElementRef<typeof TextInput> | null>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reveal = useCallback((input: React.ElementRef<typeof TextInput> | null) => {
    focusedInput.current = input;
    if (focusTimer.current) clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(() => {
      input?.measureInWindow((_x, y, _w, height) => {
        scrollRef.current?.measureInWindow((_sx, sy, _sw, sh) => {
          const visibleBottom = Math.min(sy + sh, keyboardTop.current);
          const delta = y + height + 100 - visibleBottom;
          if (delta > 0) scrollRef.current?.scrollTo({y: scrollOffset.current + delta, animated: true});
        });
      });
    }, 250);
  }, []);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', event => {keyboardTop.current = event.endCoordinates.screenY; setKeyboardOpen(true); reveal(focusedInput.current);});
    const hide = Keyboard.addListener('keyboardDidHide', () => {setKeyboardOpen(false); keyboardTop.current = Number.POSITIVE_INFINITY;});
    return () => {show.remove(); hide.remove(); if (focusTimer.current) clearTimeout(focusTimer.current);};
  }, [reveal]);
  const body = scroll ? (
    <ScrollView
      ref={scrollRef}
      onScroll={e => {scrollOffset.current = e.nativeEvent.contentOffset.y;}}
      scrollEventThrottle={16}
      onContentSizeChange={() => {if (keyboardOpen) reveal(focusedInput.current);}}
      style={styles.flex}
      contentContainerStyle={[
        styles.content,
        keyboardOpen && {paddingBottom: 180},
        footer ? styles.contentWithFooter : null,
        contentStyle,
      ]}
      showsVerticalScrollIndicator={false}
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={!!refreshing}
            onRefresh={onRefresh}
            tintColor={colors.limeDark}
          />
        ) : undefined
      }
    >
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
      style={[styles.safe, !dark && { backgroundColor: colors.body }]}
      edges={['top', 'left', 'right']}
      testID={testID}
    >
<View pointerEvents="none" style={StyleSheet.absoluteFill}><View style={{position:"absolute",width:320,height:320,borderRadius:160,top:-120,right:-100,backgroundColor:appearance.dark?"rgba(9,203,234,0.07)":"rgba(9,203,234,0.09)"}}/><View style={{position:"absolute",width:280,height:280,borderRadius:140,bottom:100,left:-140,backgroundColor:"rgba(5,99,247,0.06)"}}/></View>
      <StatusBar barStyle={dark || appearance.dark ? 'light-content' : 'dark-content'} />
      <View style={styles.header}>
        <View style={styles.side}>
          {showBack && (
            <Pressable
              onPress={onBack ?? nav.goBack}
              hitSlop={14}
              accessibilityRole="button"
              accessibilityLabel="Back"
              style={styles.backBtn}
            >
              <Icon
                name="arrow-left"
                size={22}
                color={dark ? '#FFFFFF' : colors.ink}
              />
            </Pressable>
          )}
        </View>
        <Text
          style={[styles.title, !dark && { color: colors.ink }]}
          accessibilityRole="header"
          numberOfLines={1}
        >
          {title}
        </Text>
        <View style={[styles.side, styles.sideRight]}>
          {right !== undefined && right}
          {navStateCurrent !== 'AIAssistant' && navStateCurrent !== 'Assistant' && <Pressable accessibilityRole="button" accessibilityLabel="AI assistant"
            onPress={() => nav.navigate('Assistant')} style={styles.aiButton}>
            <Icon name="sparkles" size={20} color={colors.electric} />
          </Pressable>}
        </View>
      </View>
      {headerExtra}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.body, dark && styles.bodyDark]}>
        <OfflineBanner />
        <KeyboardFocus.Provider value={reveal}>{body}</KeyboardFocus.Provider>
        {footer && (!keyboardOpen || keepFooterWithKeyboard) && (
          <View
            style={[
              styles.footer,
              {
                paddingBottom: tabBarVisible
                  ? spacing.md
                  : Math.max(insets.bottom, spacing.md),
              },
            ]}
          >
            <View style={[styles.column, styles.footerColumn]}>{footer}</View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const baseStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    minHeight: sizes.header + spacing.sm + spacing.lg,
  },
  side: { width: 44, height: 36, justifyContent: 'center' },
  sideRight: { alignItems: 'center', flexDirection: 'row', justifyContent: 'flex-end', gap: 4, width: 84 },
  aiButton: {width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.inputBorder},
  backBtn: { height: 36, justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', color: '#FFFFFF', ...type.title },
  body: {
    flex: 1,
    backgroundColor: "transparent",
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    overflow: 'hidden',
  },
  bodyDark: { backgroundColor: colors.bgRaised },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  contentWithFooter: { paddingBottom: spacing.lg },
  column: { width: '100%', maxWidth: sizes.maxContent, alignSelf: 'center' },
  footerColumn: { gap: spacing.sm },
  stack: { gap: spacing.md },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    backgroundColor: colors.body,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    gap: spacing.sm,
  },
});
