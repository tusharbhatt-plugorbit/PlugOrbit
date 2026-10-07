import React from 'react';
import {StyleSheet, View} from 'react-native';
import {colors, radii} from '../theme';

// Stylised street map drawn with plain views (no map SDK or API key needed).
// Memoised and prop-less, so it renders once and never again on filter/typing.
function MapBackdropBase(): React.JSX.Element {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={styles.parkA} />
      <View style={styles.parkB} />
      <View style={styles.parkC} />
      <View style={styles.river} />
      <View style={styles.minorA} />
      <View style={styles.minorB} />
      <View style={styles.minorVA} />
      <View style={styles.minorVB} />
      <View style={styles.mainA} />
      <View style={styles.mainB} />
      <View style={styles.mainVA} />
      <View style={styles.mainVB} />
    </View>
  );
}

const park = {
  position: 'absolute',
  backgroundColor: colors.park,
  borderRadius: radii.sm,
} as const;
const road = {
  position: 'absolute',
  left: '-10%',
  width: '120%',
  height: 10,
  backgroundColor: colors.road,
} as const;
const roadV = {
  position: 'absolute',
  top: '-5%',
  height: '110%',
  width: 10,
  backgroundColor: colors.road,
} as const;
const minor = {
  position: 'absolute',
  left: '-10%',
  width: '120%',
  height: 4,
  backgroundColor: colors.roadMinor,
} as const;
const minorV = {
  position: 'absolute',
  top: 0,
  bottom: 0,
  width: 4,
  backgroundColor: colors.roadMinor,
} as const;
const rot = (deg: number) => ({transform: [{rotate: `${deg}deg`}]});

const styles = StyleSheet.create({
  parkA: {...park, left: '58%', top: '4%', width: '16%', height: '16%'},
  parkB: {...park, left: '2%', top: '55%', width: '24%', height: '22%'},
  parkC: {...park, left: '60%', top: '70%', width: '22%', height: '14%'},
  river: {
    position: 'absolute',
    backgroundColor: colors.water,
    left: '40%',
    top: '-10%',
    width: '5%',
    height: '125%',
    ...rot(18),
  },
  minorA: {...minor, top: '18%', ...rot(-6)},
  minorB: {...minor, top: '56%', ...rot(-20)},
  minorVA: {...minorV, left: '14%'},
  minorVB: {...minorV, left: '88%'},
  mainA: {...road, top: '38%', ...rot(-14)},
  mainB: {...road, top: '72%', ...rot(8)},
  mainVA: {...roadV, left: '30%', ...rot(6)},
  mainVB: {...roadV, left: '68%', ...rot(-4)},
});

export default React.memo(MapBackdropBase);
