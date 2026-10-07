import React, {useEffect, useRef} from 'react';
import {Animated, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {createStore, useStore} from '../store/createStore';
import {colors, elevation, radii, spacing, type} from '../theme';
import {Icon} from './Icon';

type ToastTone = 'success' | 'info' | 'warn' | 'danger';
type ToastState = {id: number; message: string; tone: ToastTone} | null;

const toastStore = createStore<{current: ToastState}>({current: null});
let counter = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Show a short message from anywhere (services, recovery, screens). */
export function showToast(
  message: string,
  tone: ToastTone = 'info',
  ms = 3200,
) {
  counter += 1;
  toastStore.set({current: {id: counter, message, tone}});
  if (timer) {
    clearTimeout(timer);
  }
  timer = setTimeout(() => toastStore.set({current: null}), ms);
}

export function ToastHost() {
  const current = useStore(toastStore, s => s.current);
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: current ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [current, opacity]);

  if (!current) {
    return null;
  }
  const icon =
    current.tone === 'success'
      ? 'circle-check'
      : current.tone === 'danger'
      ? 'circle-alert'
      : current.tone === 'warn'
      ? 'triangle-alert'
      : 'info';
  const accent =
    current.tone === 'danger'
      ? '#FCA5A5'
      : current.tone === 'warn'
      ? '#FCD34D'
      : colors.lime;
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.wrap, {top: insets.top + spacing.sm, opacity}]}
      accessibilityLiveRegion="polite">
      <View style={[styles.toast, elevation(3)]}>
        <Icon name={icon} size={18} color={accent} />
        <Text style={styles.text}>{current.message}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    alignItems: 'center',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    maxWidth: 480,
  },
  text: {...type.label, color: '#FFFFFF', flexShrink: 1},
});
