import React, {useEffect, useRef} from 'react';
import {Animated, Pressable, StyleSheet, View} from 'react-native';
import type {Charger} from '../data/chargers';
import {colors, elevation} from '../theme';
import {BoltGlyph} from './Icons';

type Props = {
  charger: Charger;
  selected: boolean;
  onSelect: (id: string) => void;
};

const HEAD = 34;

function ChargerPinBase({
  charger,
  selected,
  onSelect,
}: Props): React.JSX.Element {
  const scale = useRef(new Animated.Value(selected ? 1.18 : 1)).current;

  useEffect(() => {
    Animated.spring(scale, {
      toValue: selected ? 1.18 : 1,
      friction: 6,
      tension: 140,
      useNativeDriver: true,
    }).start();
  }, [selected, scale]);

  const tone = selected ? colors.lime : colors.bg;
  const edge = selected ? colors.limeDark : colors.bg;

  return (
    <Pressable
      onPress={() => onSelect(charger.id)}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityState={{selected}}
      accessibilityLabel={`${charger.name}, ${charger.available} of ${charger.total} chargers available`}
      style={[
        styles.wrap,
        selected && styles.wrapSelected,
        {left: `${charger.x}%`, top: `${charger.y}%`},
      ]}>
      <Animated.View
        style={[styles.anchor, {transform: [{scale}]}]}
        renderToHardwareTextureAndroid>
        <View
          style={[
            styles.head,
            elevation(2),
            {backgroundColor: tone, borderColor: edge},
          ]}>
          <BoltGlyph size={15} color={selected ? colors.ink : colors.lime} />
        </View>
        <View style={[styles.tip, {borderTopColor: tone}]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Offsets put the pin's tip, not its centre, on the coordinate.
  wrap: {position: 'absolute', marginLeft: -HEAD / 2, marginTop: -(HEAD + 9)},
  wrapSelected: {zIndex: 2},
  anchor: {alignItems: 'center'},
  head: {
    width: HEAD,
    height: HEAD,
    borderRadius: HEAD / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tip: {
    width: 0,
    height: 0,
    marginTop: -2,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
});

export default React.memo(ChargerPinBase);
