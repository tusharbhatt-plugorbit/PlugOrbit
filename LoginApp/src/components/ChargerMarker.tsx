import React, {useEffect, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {Marker} from 'react-native-maps';
import {availableCount, compatibleConnectors} from '../domain/rules';
import type {StationWithDistance, Vehicle} from '../domain/types';
import {colors} from '../theme';
import {Icon} from '../ui/Icon';

type Props = {
  station: StationWithDistance;
  vehicle: Vehicle | null;
  selected: boolean;
  onSelect: (id: string) => void;
};

const HEAD = 32;
const HEAD_SELECTED = 40;
// The map snapshots a marker's child view; track only long enough to capture a
// state change, then stop (continuous tracking drains the GPU).
const SETTLE_MS = 400;

function ChargerMarkerBase({station, vehicle, selected, onSelect}: Props) {
  const [tracking, setTracking] = useState(true);

  useEffect(() => {
    setTracking(true);
    const timer = setTimeout(() => setTracking(false), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [selected]);

  const size = selected ? HEAD_SELECTED : HEAD;
  const tone = selected ? colors.lime : colors.bg;
  const edge = selected ? colors.limeDark : colors.bg;
  const free = availableCount(station, vehicle);
  const total = compatibleConnectors(station, vehicle).length;

  return (
    <Marker
      coordinate={{latitude: station.latitude, longitude: station.longitude}}
      onPress={() => onSelect(station.id)}
      anchor={{x: 0.5, y: 1}}
      tracksViewChanges={tracking}
      zIndex={selected ? 2 : 1}
      accessibilityLabel={`${station.name}, ${free} of ${total} chargers available`}>
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
          <Icon
            name="zap"
            size={selected ? 18 : 15}
            color={selected ? colors.ink : colors.lime}
            filled
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
  head: {borderWidth: 2, alignItems: 'center', justifyContent: 'center'},
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
