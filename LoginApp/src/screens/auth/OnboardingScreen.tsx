import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  BackHandler,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import {colors, radii, sizes, spacing, type} from '../../theme';
import {
  FindChargersIllustration,
  OrbitAssistIllustration,
  SmartJourneyIllustration,
} from '../../ui/illustrations';
import {useReducedMotion} from '../../ui/useReducedMotion';
import {WelcomeBackdrop} from '../../ui/WelcomeBackdrop';

type Slide = {
  key: string;
  title: string;
  body: string;
  Art: (props: {style?: object}) => React.JSX.Element;
};

// Worded to promise only what the app does: it plans, suggests and keeps a
// backup; the driver approves anything that costs money.
export const SLIDES: readonly Slide[] = [
  {
    key: 'find',
    title: 'Find charging anywhere',
    body: 'Chargers that fit your car, honest availability, and a backup ready for every stop.',
    Art: FindChargersIllustration,
  },
  {
    key: 'journey',
    title: 'Smarter journeys',
    body: 'Plan a trip and PlugOrbit works out how much charge you need, where to stop and how long it takes.',
    Art: SmartJourneyIllustration,
  },
  {
    key: 'assist',
    title: 'Drive. We’ll plan ahead.',
    body: 'Orbit Assist keeps your plan up to date and suggests a better stop if things change. You approve every payment.',
    Art: OrbitAssistIllustration,
  },
];

type Props = {
  /** Finished or skipped: carry on to creating an account. */
  onDone: () => void;
  /** Leave without finishing (hardware back from the first slide). */
  onBack: () => void;
};

/** First-run introduction: three slides, skippable, never shown again once seen. */
export function OnboardingScreen({onDone, onBack}: Props) {
  const win = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const pager = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const [width, setWidth] = useState(win.width);
  const [index, setIndex] = useState(0);
  const last = index === SLIDES.length - 1;
  const compact = win.height < 700;

  const goTo = useCallback(
    (next: number) => {
      setIndex(next);
      pager.current?.scrollTo({x: next * width, animated: !reduced});
    },
    [width, reduced],
  );

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (index > 0) {
        goTo(index - 1);
      } else {
        onBack();
      }
      return true;
    });
    return () => sub.remove();
  }, [index, goTo, onBack]);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && w !== width) {
      setWidth(w);
      pager.current?.scrollTo({x: index * w, animated: false});
    }
  };

  const onSettle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next >= 0 && next < SLIDES.length) {
      setIndex(next);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      <WelcomeBackdrop showRoad={false} showCharger={false} />
      <SafeAreaView style={styles.flex} edges={['top', 'left', 'right']}>
        <View style={styles.topBar}>
          {last ? (
            <View style={styles.skipSpace} />
          ) : (
            <Pressable
              onPress={onDone}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Skip introduction"
              style={styles.skip}>
              <Text style={styles.skipText}>Skip</Text>
            </Pressable>
          )}
        </View>

        <ScrollView
          ref={pager}
          horizontal
          pagingEnabled
          bounces={false}
          showsHorizontalScrollIndicator={false}
          onLayout={onLayout}
          onMomentumScrollEnd={onSettle}
          style={styles.flex}>
          {SLIDES.map((s, i) => (
            <ScrollView
              key={s.key}
              style={{width}}
              contentContainerStyle={styles.page}
              showsVerticalScrollIndicator={false}
              accessibilityElementsHidden={i !== index}
              importantForAccessibility={
                i === index ? 'auto' : 'no-hide-descendants'
              }>
              <View style={styles.column}>
                <s.Art style={compact ? styles.artCompact : undefined} />
                <Text
                  style={[styles.title, compact && styles.titleCompact]}
                  accessibilityRole="header"
                  maxFontSizeMultiplier={1.3}>
                  {s.title}
                </Text>
                <Text style={styles.body} maxFontSizeMultiplier={1.3}>
                  {s.body}
                </Text>
              </View>
            </ScrollView>
          ))}
        </ScrollView>

        <View
          style={[
            styles.footer,
            {paddingBottom: Math.max(insets.bottom, spacing.lg)},
          ]}>
          <View style={styles.column}>
            <View
              style={styles.dots}
              accessible
              accessibilityLabel={`Step ${index + 1} of ${SLIDES.length}`}
              accessibilityLiveRegion="polite">
              {SLIDES.map((s, i) => (
                <View
                  key={s.key}
                  style={[styles.dot, i === index && styles.dotActive]}
                />
              ))}
            </View>
            <Pressable
              onPress={last ? onDone : () => goTo(index + 1)}
              accessibilityRole="button"
              accessibilityLabel={last ? 'Get started' : 'Next'}
              android_ripple={{color: 'rgba(0,0,0,0.12)'}}
              style={({pressed}) => [
                styles.primary,
                pressed && styles.pressed,
              ]}>
              <Text style={styles.primaryText}>
                {last ? 'Get started' : 'Next'}
              </Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.bg},
  flex: {flex: 1},
  topBar: {
    height: sizes.tap + spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  skip: {
    minHeight: sizes.tap,
    minWidth: sizes.tap,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipSpace: {height: sizes.tap},
  skipText: {...type.bodyStrong, fontSize: 15, color: '#E2E8F0'},
  page: {flexGrow: 1, justifyContent: 'center', paddingVertical: spacing.md},
  column: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    paddingHorizontal: spacing.xxl,
  },
  artCompact: {maxHeight: 150},
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  titleCompact: {fontSize: 24, lineHeight: 30, marginTop: spacing.md},
  body: {
    fontSize: 16,
    lineHeight: 24,
    color: '#CBD5E1',
    textAlign: 'center',
    marginTop: spacing.md,
  },
  footer: {paddingTop: spacing.md},
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: spacing.lg,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(203, 213, 225, 0.35)',
  },
  dotActive: {width: 26, backgroundColor: colors.lime},
  primary: {
    minHeight: sizes.buttonLarge,
    borderRadius: radii.lg,
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {...type.button, fontSize: 18, color: colors.ink},
  pressed: {opacity: 0.88},
});
