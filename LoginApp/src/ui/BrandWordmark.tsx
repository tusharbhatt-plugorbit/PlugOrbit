import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {BrandLogo} from './BrandLogo';
import {useAppearance} from '../appearance';

/** Explicit surface colour: auth's light/dark mode can differ from the phone theme. */
export function BrandWordmark({light, size = 24}: {light?: boolean; size?: number}) {
  const appearance = useAppearance();
  const onDarkSurface = light ?? appearance.dark;
  return (
    <View style={styles.row} accessible accessibilityLabel="PlugOrbit">
      <BrandLogo size={size * 1.24} borderColor="rgba(0,204,244,0.24)" />
      <Text style={[styles.name, {fontSize: size, color: onDarkSurface ? '#FFFFFF' : '#0F172A'}]}>
        Plug<Text style={[styles.orbit, {color: onDarkSurface ? '#00CCF4' : '#007B9E'}]}>Orb<Text style={[styles.green, {color: onDarkSurface ? '#00B974' : '#08755F'}]}>it</Text></Text>
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
