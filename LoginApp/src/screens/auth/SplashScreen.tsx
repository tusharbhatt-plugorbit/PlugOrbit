import React, {useEffect, useRef} from 'react';
import {
  Animated,
  Easing,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {colors, type} from '../../theme';
import {BrandLogo} from '../../ui/BrandLogo';
import {useReducedMotion} from '../../ui/useReducedMotion';
import {WelcomeBackdrop} from '../../ui/WelcomeBackdrop';

/**
 * Shown while saved state loads, so a signed-in person never sees the Welcome
 * screen flash by. The mark settles in gently; with reduced motion it is simply there.
 */
export function SplashScreen(): React.JSX.Element {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }
    Animated.timing(progress, {
      toValue: 1,
      duration: 520,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [reduced, progress]);

  return (
    <View style={styles.root} accessibilityLabel="PlugOrbit is loading">
      <StatusBar barStyle="light-content" />
      <WelcomeBackdrop showRoad={false} showCharger={false} />
      <Animated.View
        style={[
          styles.center,
          {
            opacity: progress,
            transform: [
              {
                scale: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.92, 1],
                }),
              },
            ],
          },
        ]}>
        <BrandLogo size={72} glow />
        <Text style={styles.name}>PlugOrbit</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.bg},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12},
  name: {...type.brand, color: '#FFFFFF'},
});
