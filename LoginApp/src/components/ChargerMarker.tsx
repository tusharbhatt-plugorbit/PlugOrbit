import React, {useEffect, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {Marker} from 'react-native-maps';
import {
  availableCount,
  compatibleConnectors,
  stationHealth,
} from '../domain/rules';
import type {StationWithDistance, Vehicle} from '../domain/types';
import {colors} from '../theme';
import {Icon} from '../ui/Icon';

type Props = {
  station: StationWithDistance;
  vehicle: Vehicle | null;
  selected: boolean;
  onSelect: (id: string) => void;
  /** Your charging stop (large, lime) or its backup (blue); others are normal. */
  role?: 'primary' | 'backup';
};

const HEAD = 32;
const HEAD_SELECTED = 40;
const HEAD_PRIMARY = 48;
const HEAD_BACKUP = 38;
// The map snapshots a marker's child view; track only long enough to capture a
// state change, then stop (continuous tracking drains the GPU).
const SETTLE_MS = 400;

/**
 * Pin look by what it means to the driver: the stop PlugOrbit chose is big and
 * lime, its backup is blue, and everything else says whether it can be used:
 * navy (free), amber (busy), red (out of service), grey (unknown).
 */
function look(
  role: Props['role'],
  selected: boolean,
  health: ReturnType<typeof stationHealth>,
) {
  if (role === 'primary') {
    return {
      size: HEAD_PRIMARY,
      bg: colors.lime,
      edge: colors.limeDark,
      icon: colors.ink,
      zIndex: 4,
    };
  }
  if (role === 'backup') {
    return {
      size: HEAD_BACKUP,
      bg: colors.info,
      edge: colors.surface,
      icon: '#FFFFFF',
      zIndex: 3,
    };
  }
  if (selected) {
    return {
      size: HEAD_SELECTED,
      bg: colors.lime,
      edge: colors.limeDark,
      icon: colors.ink,
      zIndex: 2,
    };
  }
  switch (health) {
    case 'busy':
      return {
        size: HEAD,
        bg: colors.amber,
        edge: colors.amber,
        icon: '#FFFFFF',
        zIndex: 1,
      };
    case 'offline':
      return {
        size: HEAD,
        bg: colors.dangerSoft,
        edge: colors.danger,
        icon: colors.danger,
        zIndex: 1,
      };
    case 'unknown':
      return {
        size: HEAD,
        bg: colors.slateSoft,
        edge: colors.placeholder,
        icon: colors.muted,
        zIndex: 1,
      };
    default:
      return {
        size: HEAD,
        bg: colors.bg,
        edge: colors.bg,
        icon: colors.lime,
        zIndex: 1,
      };
  }
}

function ChargerMarkerBase({
  station,
  vehicle,
  selected,
  onSelect,
  role,
}: Props) {
  const [tracking, setTracking] = useState(true);

  useEffect(() => {
    setTracking(true);
    const timer = setTimeout(() => setTracking(false), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [selected, role]);

  const free = availableCount(station, vehicle);
  const total = compatibleConnectors(station, vehicle).length;
  const v = look(role, selected, stationHealth(station, vehicle));
  const label =
    role === 'primary'
      ? 'Your charging stop, '
      : role === 'backup'
      ? 'Your backup, '
      : '';

  return (
    <Marker
      coordinate={{latitude: station.latitude, longitude: station.longitude}}
      onPress={() => onSelect(station.id)}
      anchor={{x: 0.5, y: 1}}
      tracksViewChanges={tracking}
      zIndex={v.zIndex}
      accessibilityLabel={`${label}${station.name}, ${free} of ${total} chargers available`}>
      <View style={styles.box}>
        <View
          style={[
            styles.head,
            {
              width: v.size,
              height: v.size,
              borderRadius: v.size / 2,
              backgroundColor: v.bg,
              borderColor: v.edge,
            },
          ]}>
          <Icon
            name="zap"
            size={
              v.size >= HEAD_PRIMARY ? 22 : v.size >= HEAD_SELECTED ? 18 : 15
            }
            color={v.icon}
            filled
          />
        </View>
        <View style={[styles.tip, {borderTopColor: v.bg}]} />
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  // Fixed box so the snapshot is the same size for both states.
  box: {
    width: HEAD_PRIMARY + 4,
    height: HEAD_PRIMARY + 14,
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
