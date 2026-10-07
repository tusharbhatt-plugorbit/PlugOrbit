import React, {useEffect, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {Marker} from 'react-native-maps';
import type {ChargerWithDistance} from '../data/chargers';
import {colors} from '../theme';
import {BoltGlyph} from './Icons';

type Props = {
  charger: ChargerWithDistance;
  selected: boolean;
  onSelect: (id: string) => void;
};

const HEAD = 32;
const HEAD_SELECTED = 40;
// Android/iOS snapshot a marker's child view; keep tracking only long enough
// to capture a state change, then stop (continuous tracking drains the GPU).
const SETTLE_MS = 400;

function ChargerMarkerBase({charger, selected, onSelect}: Props) {
  const [tracking, setTracking] = useState(true);

  useEffect(() => {
    setTracking(true);
    const timer = setTimeout(() => setTracking(false), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [selected]);

  const size = selected ? HEAD_SELECTED : HEAD;
  const tone = selected ? colors.lime : colors.bg;
  const edge = selected ? colors.limeDark : colors.bg;
  const label =
    charger.available !== null && charger.total !== null
      ? `${charger.name}, ${charger.available} of ${charger.total} chargers available`
      : charger.name;

  return (
    <Marker
      coordinate={{latitude: charger.latitude, longitude: charger.longitude}}
      onPress={() => onSelect(charger.id)}
      anchor={{x: 0.5, y: 1}}
      tracksViewChanges={tracking}
      zIndex={selected ? 2 : 1}
      accessibilityLabel={label}>
      <View style={styles.box}>
        <View
          style={[
            styles.head,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: tone,
              borderColor: edge,
            },
          ]}>
          <BoltGlyph
            size={selected ? 18 : 15}
            color={selected ? colors.ink : colors.lime}
          />
        </View>
        <View style={[styles.tip, {borderTopColor: tone}]} />
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  // Fixed box so the snapshot is the same size for both states.
  box: {
    width: HEAD_SELECTED + 4,
    height: HEAD_SELECTED + 14,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  head: {
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

export default React.memo(ChargerMarkerBase);
