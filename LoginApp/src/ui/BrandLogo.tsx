import React from 'react';
import {Image, StyleSheet, View} from 'react-native';
import {colors} from '../theme';

const LOGO_MARK = require('../../assets/brand/logo-mark.png');

// The mark is a navy rounded tile; its corner radius is 232/1024 of its size.
const TILE_RADIUS = 232 / 1024;

type Props = {
  size?: number;
  /** Soft lime "orbit" halo, for hero placements on dark screens. */
  glow?: boolean;
  /** Hairline round the tile so it stays visible on the dark header/backdrop. */
  borderColor?: string;
};

/**
 * The PlugOrbit mark: a P with a charge bolt, circled by an orbit route. It is
 * a self-contained tile (dark navy, lime and white), so the same image works on
 * the dark header, the white login card and the launcher icon.
 */
export function BrandLogo({
  size = 40,
  glow = false,
  borderColor = colors.limeHaloBorder,
}: Props) {
  const tile = (
    <View
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: size * TILE_RADIUS,
          borderColor,
        },
        glow && styles.tileGlow,
      ]}>
      <Image
        source={LOGO_MARK}
        style={styles.mark}
        resizeMode="contain"
        accessibilityRole="image"
        accessibilityLabel="PlugOrbit logo"
      />
    </View>
  );
  if (!glow) {
    return tile;
  }
  const halo = size * 1.5;
  return (
    <View
      style={[
        styles.halo,
        {width: halo, height: halo, borderRadius: halo / 2},
      ]}>
      {tile}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderWidth: StyleSheet.hairlineWidth * 2,
    backgroundColor: colors.bg,
    overflow: 'hidden',
  },
  tileGlow: {
    shadowColor: colors.lime,
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: {width: 0, height: 0},
    elevation: 10,
    overflow: 'visible',
  },
  mark: {width: '100%', height: '100%'},
  halo: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.limeHalo,
    borderWidth: 1,
    borderColor: colors.limeHaloBorder,
  },
});
