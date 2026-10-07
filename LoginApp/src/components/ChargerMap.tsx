import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
} from 'react';
import {Platform, StyleSheet} from 'react-native';
import MapView, {PROVIDER_GOOGLE, Region} from 'react-native-maps';
import {hasGoogleApiKey} from '../config/google';
import type {ChargerWithDistance} from '../data/chargers';
import type {Coords} from '../utils/geo';
import ChargerMarker from './ChargerMarker';

export type ChargerMapHandle = {
  animateTo: (center: Coords, zoomedIn?: boolean) => void;
};

type Props = {
  initialCenter: Coords;
  chargers: readonly ChargerWithDistance[];
  selectedId: string | null;
  showUserLocation: boolean;
  onSelect: (id: string) => void;
  onDeselect: () => void;
  onCenterChange: (center: Coords) => void;
};

// Android's default provider is already Google. On iOS the Google SDK throws
// at map creation if it was never given a key, so only opt in when one exists;
// without a key iOS falls back to Apple Maps.
const MAP_PROVIDER =
  Platform.OS === 'ios' && !hasGoogleApiKey ? undefined : PROVIDER_GOOGLE;

const WIDE_DELTA = 0.08; // ~9 km across
const CLOSE_DELTA = 0.02;

const ChargerMap = forwardRef<ChargerMapHandle, Props>(function ChargerMapInner(
  {
    initialCenter,
    chargers,
    selectedId,
    showUserLocation,
    onSelect,
    onDeselect,
    onCenterChange,
  },
  ref,
) {
  const mapRef = useRef<MapView>(null);

  useImperativeHandle(
    ref,
    () => ({
      animateTo: (center, zoomedIn = false) => {
        const delta = zoomedIn ? CLOSE_DELTA : WIDE_DELTA;
        mapRef.current?.animateToRegion(
          {...center, latitudeDelta: delta, longitudeDelta: delta},
          350,
        );
      },
    }),
    [],
  );

  const handleRegionChange = useCallback(
    (region: Region, details?: {isGesture?: boolean}) => {
      // Ignore our own animations; only user pans should offer a re-search.
      if (details?.isGesture) {
        onCenterChange({
          latitude: region.latitude,
          longitude: region.longitude,
        });
      }
    },
    [onCenterChange],
  );

  return (
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      provider={MAP_PROVIDER}
      initialRegion={{
        ...initialCenter,
        latitudeDelta: WIDE_DELTA,
        longitudeDelta: WIDE_DELTA,
      }}
      showsUserLocation={showUserLocation}
      showsMyLocationButton={false}
      toolbarEnabled={false}
      showsCompass={false}
      rotateEnabled={false}
      pitchEnabled={false}
      onPress={onDeselect}
      onRegionChangeComplete={handleRegionChange}>
      {chargers.map(ch => (
        <ChargerMarker
          key={ch.id}
          charger={ch}
          selected={ch.id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </MapView>
  );
});

export default React.memo(ChargerMap);
