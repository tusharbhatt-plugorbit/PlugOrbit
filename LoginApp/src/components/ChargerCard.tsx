import React, {useEffect, useRef} from 'react';
import {Animated, Pressable, StyleSheet, Text, View} from 'react-native';
import type {ChargerWithDistance} from '../data/chargers';
import {formatDistance} from '../utils/geo';
import {colors, elevation, radii, spacing} from '../theme';
import {BoltGlyph, CloseIcon, NavigateIcon} from './Icons';

type Props = {
  charger: ChargerWithDistance;
  bottomInset: number;
  onClose: () => void;
  onDirections?: (charger: ChargerWithDistance) => void;
};

function ChargerCardBase({
  charger,
  bottomInset,
  onClose,
  onDirections,
}: Props): React.JSX.Element {
  const enter = useRef(new Animated.Value(0)).current;
  const status =
    charger.available === null
      ? 'unknown'
      : charger.available === 0
      ? 'busy'
      : 'available';
  const busy = status === 'busy';
  const distance = formatDistance(charger.distanceKm);
  const hoursLine = [distance, charger.hours].filter(Boolean).join('  •  ');
  const powerLine = [
    charger.powerKw !== null ? `${charger.powerKw} kW` : null,
    charger.available !== null && charger.total !== null
      ? `${charger.available}/${charger.total} available`
      : charger.total !== null
      ? `${charger.total} connectors`
      : null,
  ]
    .filter(Boolean)
    .join('  •  ');

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
            {hoursLine}
          </Text>
          {powerLine !== '' && (
            <Text style={styles.line} numberOfLines={1}>
              {powerLine}
            </Text>
          )}
          {charger.address !== null && (
            <Text style={styles.address} numberOfLines={1}>
              {charger.address}
            </Text>
          )}
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
        <View
          style={[
            styles.pill,
            busy && styles.pillBusy,
            status === 'unknown' && styles.pillUnknown,
          ]}>
          <Text
            style={[
              styles.pillText,
              busy && styles.pillTextBusy,
              status === 'unknown' && styles.pillTextUnknown,
            ]}>
            {status === 'unknown'
              ? 'Status unknown'
              : busy
              ? 'Busy'
              : 'Available'}
          </Text>
        </View>
        {charger.pricePerKwh !== null && (
          <Text style={styles.price}>
            ₹{charger.pricePerKwh}
            <Text style={styles.priceUnit}>/kWh</Text>
          </Text>
        )}
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
  address: {color: colors.muted, fontSize: 12, marginTop: 2},
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
  pillUnknown: {backgroundColor: '#E2E8F0'},
  pillText: {color: colors.limeDark, fontSize: 12, fontWeight: '800'},
  pillTextBusy: {color: colors.danger},
  pillTextUnknown: {color: colors.inkSoft},
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
