import React, {useEffect, useRef} from 'react';
import {Platform, StyleSheet, View} from 'react-native';
import MapView, {Marker, Polyline, PROVIDER_GOOGLE} from 'react-native-maps';
import {hasIosMapsKey} from '../config/google';
import {colors, radii} from '../theme';
import type {Coords} from '../utils/geo';
import {Icon} from './Icon';

const PROVIDER =
  Platform.OS === 'ios' && !hasIosMapsKey ? undefined : PROVIDER_GOOGLE;

/** A station pin with the line from where the driver is. */
export function StationMiniMap({
  from,
  to,
  height = 200,
}: {
  from: Coords;
  to: Coords;
  height?: number;
}) {
  const ref = useRef<MapView>(null);
  const region = {
    latitude: (from.latitude + to.latitude) / 2,
    longitude: (from.longitude + to.longitude) / 2,
    latitudeDelta: Math.max(0.04, Math.abs(from.latitude - to.latitude) * 1.8),
    longitudeDelta: Math.max(
      0.04,
      Math.abs(from.longitude - to.longitude) * 1.8,
    ),
  };
  useEffect(() => {
    ref.current?.animateToRegion(region, 250);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from.latitude, from.longitude, to.latitude, to.longitude]);

  return (
    <View style={[styles.wrap, {height}]}>
      <MapView
        ref={ref}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER}
        initialRegion={region}
        toolbarEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        scrollEnabled={false}
        zoomEnabled={false}
        showsCompass={false}>
        <Polyline
          coordinates={[from, to]}
          strokeColor={colors.bg}
          strokeWidth={4}
        />
        <Marker coordinate={from} anchor={{x: 0.5, y: 0.5}}>
          <View style={styles.me} />
        </Marker>
        <Marker
          coordinate={to}
          anchor={{x: 0.5, y: 0.5}}
          tracksViewChanges={false}>
          <View style={styles.pin}>
            <Icon name="zap" size={16} color={colors.ink} filled />
          </View>
        </Marker>
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: colors.mapBg,
  },
  me: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#2563EB',
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  pin: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.lime,
    borderWidth: 3,
    borderColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
