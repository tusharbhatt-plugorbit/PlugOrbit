import React from 'react';
import {
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
import {BrandLogo} from '../../ui/BrandLogo';
import {RouteHeroIllustration} from '../../ui/illustrations';
import {WelcomeBackdrop} from '../../ui/WelcomeBackdrop';

type Props = {
  onGetStarted: () => void;
  onLogIn: () => void;
};

/**
 * First screen: what PlugOrbit does, in one promise, and the two ways in. The
 * buttons are pinned under the scrolling copy, so they stay on screen on a
 * short phone or with large system text.
 */
export function WelcomeScreen({onGetStarted, onLogIn}: Props) {
  const {height, fontScale} = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = height < 700 || fontScale > 1.3;

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      <WelcomeBackdrop showRoad={false} showCharger={false} />
      <SafeAreaView style={styles.flex} edges={['top', 'left', 'right']}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          bounces={false}
          showsVerticalScrollIndicator={false}>
          <View style={styles.column}>
            <View style={styles.brand}>
              <BrandLogo size={compact ? 32 : 40} />
              <Text style={styles.brandName}>PlugOrbit</Text>
            </View>

            <RouteHeroIllustration
              style={[styles.hero, compact && styles.heroCompact]}
            />

            <Text
              style={[styles.headline, compact && styles.headlineCompact]}
              accessibilityRole="header"
              maxFontSizeMultiplier={1.3}>
              {'Tell us where\nyou’re going.'}
            </Text>
            <Text
              style={[styles.promise, compact && styles.promiseCompact]}
              maxFontSizeMultiplier={1.3}>
              We’ll handle the charging journey.
            </Text>
            {!compact && (
              <Text style={styles.support}>
                PlugOrbit plans the route, picks chargers that fit your car and
                keeps a backup ready.
              </Text>
            )}
          </View>
        </ScrollView>

        <View
          style={[
            styles.actions,
            {paddingBottom: Math.max(insets.bottom, spacing.lg)},
          ]}>
          <View style={styles.column}>
            <Pressable
              onPress={onGetStarted}
              accessibilityRole="button"
              accessibilityLabel="Get started"
              android_ripple={{color: 'rgba(0,0,0,0.12)'}}
              style={({pressed}) => [
                styles.primary,
                pressed && styles.pressed,
              ]}>
              <Text style={styles.primaryText}>Get started</Text>
            </Pressable>
            <Pressable
              onPress={onLogIn}
              accessibilityRole="button"
              accessibilityLabel="Log in"
              accessibilityHint="For people who already have a PlugOrbit account"
              style={({pressed}) => [
                styles.secondary,
                pressed && styles.secondaryPressed,
              ]}>
              <Text style={styles.secondaryText}>
                I already have an account
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
  content: {flexGrow: 1, justifyContent: 'center', paddingVertical: spacing.md},
  column: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    paddingHorizontal: spacing.xxl,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: spacing.md,
  },
  brandName: {...type.heading, fontSize: 20, color: '#FFFFFF'},
  hero: {alignSelf: 'center', maxHeight: 250},
  heroCompact: {maxHeight: 120},
  headline: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  headlineCompact: {fontSize: 25, lineHeight: 31, marginTop: spacing.sm},
  promise: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
    color: colors.lime,
    textAlign: 'center',
    marginTop: 6,
  },
  promiseCompact: {fontSize: 17, lineHeight: 23},
  support: {
    fontSize: 15,
    lineHeight: 22,
    color: '#CBD5E1',
    textAlign: 'center',
    marginTop: spacing.md,
  },
  actions: {paddingTop: spacing.md, gap: spacing.md},
  primary: {
    minHeight: sizes.buttonLarge,
    borderRadius: radii.lg,
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  primaryText: {...type.button, fontSize: 18, color: colors.ink},
  pressed: {opacity: 0.88},
  secondary: {
    minHeight: sizes.button,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: 'rgba(203, 213, 225, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryPressed: {backgroundColor: 'rgba(255,255,255,0.08)'},
  secondaryText: {...type.bodyStrong, fontSize: 15, color: '#FFFFFF'},
});
