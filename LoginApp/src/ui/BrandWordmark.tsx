import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {BrandLogo} from './BrandLogo';

/** Explicit surface colour: auth's light/dark mode can differ from the phone theme. */
export function BrandWordmark({light = false, size = 24}: {light?: boolean; size?: number}) {
  return (
    <View style={styles.row} accessible accessibilityLabel="PlugOrbit">
      <BrandLogo size={size * 1.24} borderColor="rgba(0,204,244,0.24)" />
      <Text style={[styles.name, {fontSize: size, color: light ? '#FFFFFF' : '#0F172A'}]}>
        Plug<Text style={[styles.orbit, {color: light ? '#00CCF4' : '#008DAE'}]}>Orb<Text style={styles.green}>it</Text></Text>
      </Text>
    </View>
  );
}
const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1},
  name: {fontWeight: '900', letterSpacing: -1},
  orbit: {color: '#008DAE', fontStyle: 'italic'},
  green: {color: '#00B974'},
});
