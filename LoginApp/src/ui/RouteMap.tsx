import React, {useEffect, useRef} from 'react';
import {Platform, StyleSheet, View} from 'react-native';
import MapView, {Marker, Polyline, PROVIDER_GOOGLE} from 'react-native-maps';
import {hasIosMapsKey, mapsKeyMissing} from '../config/google';
import type {Route} from '../domain/types';
import {colors, radii} from '../theme';
import type {Coords} from '../utils/geo';
import {Icon} from './Icon';
import {MapPlaceholder} from './MapPlaceholder';

const PROVIDER =
  Platform.OS === 'ios' && !hasIosMapsKey ? undefined : PROVIDER_GOOGLE;

function bounds(points: readonly Coords[]) {
  const lats = points.map(p => p.latitude);
  const lngs = points.map(p => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.05, (maxLat - minLat) * 1.35),
    longitudeDelta: Math.max(0.05, (maxLng - minLng) * 1.35),
  };
}

/** Route polyline with start, destination and charging-stop markers. */
export function RouteMap({
  route,
  height = 240,
  highlightStop,
}: {
  route: Route;
  height?: number;
  /** Index of the stop to emphasise (e.g. the chosen one). */
  highlightStop?: number;
}) {
  const ref = useRef<MapView>(null);
  const first = route.polyline[0];
  const last = route.polyline[route.polyline.length - 1];

  useEffect(() => {
    ref.current?.animateToRegion(bounds(route.polyline), 300);
  }, [route]);

  if (mapsKeyMissing) {
    return <MapPlaceholder height={height} />;
  }

  return (
    <View
      style={[styles.wrap, {height}]}
      accessibilityLabel={`Map of ${route.fromLabel} to ${route.toLabel}`}>
      <MapView
        ref={ref}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER}
        initialRegion={bounds(route.polyline)}
        toolbarEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        showsCompass={false}>
        <Polyline
          coordinates={[...route.polyline]}
          strokeColor={colors.bg}
          strokeWidth={5}
        />
        <Marker coordinate={first} anchor={{x: 0.5, y: 0.5}}>
          <View style={styles.endpoint} />
        </Marker>
        <Marker coordinate={last} anchor={{x: 0.5, y: 0.5}}>
          <View style={[styles.endpoint, styles.endpointEnd]} />
        </Marker>
        {route.stops.map((s, i) => (
          <Marker
            key={s.station.id}
            coordinate={{
              latitude: s.station.latitude,
              longitude: s.station.longitude,
            }}
            anchor={{x: 0.5, y: 0.5}}
            tracksViewChanges={false}>
            <View style={[styles.stop, highlightStop === i && styles.stopOn]}>
              <Icon
                name="zap"
                size={14}
                color={highlightStop === i ? colors.ink : colors.lime}
                filled
              />
            </View>
          </Marker>
        ))}
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
  endpoint: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 4,
    borderColor: colors.bg,
  },
  endpointEnd: {backgroundColor: colors.lime},
  stop: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  stopOn: {backgroundColor: colors.lime, borderColor: colors.limeDark},
});
