import React, {useEffect, useRef} from 'react';
import {Animated, Pressable, StyleSheet, Text, View} from 'react-native';
import type {Charger} from '../data/chargers';
import {colors, elevation, radii, spacing} from '../theme';
import {BoltGlyph, CloseIcon, NavigateIcon} from './Icons';

type Props = {
  charger: Charger;
  bottomInset: number;
  onClose: () => void;
  onDirections?: (charger: Charger) => void;
};

function ChargerCardBase({
  charger,
  bottomInset,
  onClose,
  onDirections,
}: Props): React.JSX.Element {
  const enter = useRef(new Animated.Value(0)).current;
  const busy = charger.available === 0;

  // Slide/fade in whenever a different charger is selected.
  useEffect(() => {
    enter.setValue(0);
    Animated.timing(enter, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [charger.id, enter]);

  return (
    <Animated.View
      style={[
        styles.card,
        elevation(3),
        {
          bottom: spacing.xl + bottomInset,
          opacity: enter,
          transform: [
            {
              translateY: enter.interpolate({
                inputRange: [0, 1],
                outputRange: [24, 0],
              }),
            },
          ],
        },
      ]}>
      <View style={styles.top}>
        <View style={styles.thumb}>
          <BoltGlyph size={28} color={colors.limeDark} />
        </View>

        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={1}>
            {charger.name}
          </Text>
          <Text style={styles.line} numberOfLines={1}>
            {charger.distanceKm} km • {charger.hours}
          </Text>
          <Text style={styles.line} numberOfLines={1}>
            {charger.powerKw} kW • {charger.available}/{charger.total} available
          </Text>
        </View>

        <Pressable
          onPress={onClose}
          hitSlop={14}
          accessibilityRole="button"
          accessibilityLabel="Close details"
          style={styles.close}>
          <CloseIcon size={12} color={colors.ink} />
        </Pressable>
      </View>

      <View style={styles.priceRow}>
        <View style={[styles.pill, busy && styles.pillBusy]}>
          <Text style={[styles.pillText, busy && styles.pillTextBusy]}>
            {busy ? 'Busy' : 'Available'}
          </Text>
        </View>
        <Text style={styles.price}>
          ₹{charger.pricePerKwh}
          <Text style={styles.priceUnit}>/kWh</Text>
        </Text>
      </View>

      <Pressable
        onPress={() => onDirections?.(charger)}
        accessibilityRole="button"
        accessibilityLabel={`Directions to ${charger.name}`}
        android_ripple={{color: 'rgba(255,255,255,0.18)'}}
        style={({pressed}) => [styles.cta, pressed && styles.ctaPressed]}>
        <NavigateIcon size={13} color="#FFFFFF" />
        <Text style={styles.ctaText}>Directions</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  top: {flexDirection: 'row', alignItems: 'flex-start'},
  thumb: {
    width: 62,
    height: 62,
    borderRadius: radii.md,
    backgroundColor: colors.limeSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {flex: 1, marginHorizontal: spacing.md},
  title: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 4,
  },
  line: {color: colors.inkSoft, fontSize: 12.5, marginTop: 2},
  close: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
    marginBottom: 14,
  },
  pill: {
    backgroundColor: colors.limeSoft,
    borderRadius: radii.sm,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginRight: spacing.md,
  },
  pillBusy: {backgroundColor: colors.dangerSoft},
  pillText: {color: colors.limeDark, fontSize: 12, fontWeight: '800'},
  pillTextBusy: {color: colors.danger},
  price: {color: colors.ink, fontSize: 16, fontWeight: '800'},
  priceUnit: {color: colors.muted, fontSize: 12, fontWeight: '600'},
  cta: {
    height: 50,
    borderRadius: radii.md,
    backgroundColor: colors.bg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    overflow: 'hidden',
  },
  ctaPressed: {opacity: 0.85, transform: [{scale: 0.99}]},
  ctaText: {color: '#FFFFFF', fontSize: 15, fontWeight: '700'},
});

export default React.memo(ChargerCardBase);
