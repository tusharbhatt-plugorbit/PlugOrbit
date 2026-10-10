import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import {Platform, StyleSheet} from 'react-native';
import MapView, {PROVIDER_GOOGLE, Polyline, Region} from 'react-native-maps';
import {hasIosMapsKey, mapsKeyMissing} from '../config/google';
import {availableCount, compatibleConnectors} from '../domain/rules';
import type {StationWithDistance, Vehicle} from '../domain/types';
import type {MapPin} from '../maps/osmMapHtml';
import {colors} from '../theme';
import type {Coords} from '../utils/geo';
import ChargerMarker from './ChargerMarker';
import OsmMap, {OsmMapHandle} from './OsmMap';

export type ChargerMapHandle = {
  animateTo: (center: Coords, zoomedIn?: boolean) => void;
};

type Props = {
  initialCenter: Coords;
  chargers: readonly StationWithDistance[];
  vehicle: Vehicle | null;
  selectedId: string | null;
  showUserLocation: boolean;
  /**
   * Where the device is. The Google/Apple map draws its own blue dot from
   * `showUserLocation`; the fallback map has to be told where to put it.
   */
  userLocation?: Coords | null;
  onSelect: (id: string) => void;
  onDeselect: () => void;
  onCenterChange: (center: Coords) => void;
  /** The native map finished initialising (it can still be loading tiles). */
  onReady?: () => void;
  /** The map cannot be drawn in this build; show something else instead. */
  onUnavailable?: () => void;
  /**
   * A route to draw under the markers (decoded from Directions later). Nothing
   * is drawn for fewer than two points, so callers can pass it unconditionally.
   */
  route?: readonly Coords[];
};

// Android's default provider is already Google. On iOS the Google SDK throws
// at map creation if it was never given a key, so only opt in when one exists;
// without a key iOS falls back to Apple Maps.
const MAP_PROVIDER =
  Platform.OS === 'ios' && !hasIosMapsKey ? undefined : PROVIDER_GOOGLE;

const WIDE_DELTA = 0.08; // ~9 km across
const CLOSE_DELTA = 0.02;

const NativeChargerMap = forwardRef<ChargerMapHandle, Props>(
  function NativeChargerMapInner(
    {
      initialCenter,
      chargers,
      vehicle,
      selectedId,
      showUserLocation,
      onSelect,
      onDeselect,
      onCenterChange,
      onReady,
      route,
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
        onMapReady={onReady}
        onRegionChangeComplete={handleRegionChange}>
        {route && route.length > 1 && (
          <Polyline
            coordinates={route.map(p => ({
              latitude: p.latitude,
              longitude: p.longitude,
            }))}
            strokeColor={colors.limeDark}
            strokeWidth={5}
          />
        )}
        {chargers.map(ch => (
          <ChargerMarker
            key={ch.id}
            station={ch}
            vehicle={vehicle}
            selected={ch.id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </MapView>
    );
  },
);

/**
 * The same map on OpenStreetMap tiles, which need no key. Used on Android
 * builds that were not given a Google Maps key, where the Google SDK would only
 * draw a blank grey rectangle.
 */
const FallbackChargerMap = forwardRef<ChargerMapHandle, Props>(
  function FallbackChargerMapInner(
    {
      initialCenter,
      chargers,
      vehicle,
      selectedId,
      showUserLocation,
      userLocation,
      onSelect,
      onDeselect,
      onCenterChange,
      onReady,
      onUnavailable,
      route,
    },
    ref,
  ) {
    const mapRef = useRef<OsmMapHandle>(null);
    useImperativeHandle(
      ref,
      () => ({
        animateTo: (center, zoomedIn) =>
          mapRef.current?.animateTo(center, zoomedIn),
      }),
      [],
    );

    const pins = useMemo<MapPin[]>(() => {
      const list: MapPin[] = chargers.map(ch => {
        const free = availableCount(ch, vehicle);
        const total = compatibleConnectors(ch, vehicle).length;
        return {
          id: ch.id,
          latitude: ch.latitude,
          longitude: ch.longitude,
          kind: 'charger',
          selected: ch.id === selectedId,
          pressable: true,
          label: `${ch.name}, ${free} of ${total} chargers available`,
        };
      });
      if (showUserLocation && userLocation) {
        list.push({
          id: '__me',
          latitude: userLocation.latitude,
          longitude: userLocation.longitude,
          kind: 'me',
          label: 'Your location',
        });
      }
      return list;
    }, [chargers, vehicle, selectedId, showUserLocation, userLocation]);

    const line = useMemo(
      () =>
        route && route.length > 1
          ? {
              points: route.map(
                p => [p.latitude, p.longitude] as [number, number],
              ),
              color: colors.limeDark,
              width: 5,
            }
          : null,
      [route],
    );

    return (
      <OsmMap
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialCenter={initialCenter}
        pins={pins}
        route={line}
        onPinPress={onSelect}
        onPress={onDeselect}
        onCenterChange={onCenterChange}
        onReady={onReady}
        onUnavailable={onUnavailable}
      />
    );
  },
);

const ChargerMap = forwardRef<ChargerMapHandle, Props>(function ChargerMapInner(
  props,
  ref,
) {
  return mapsKeyMissing ? (
    <FallbackChargerMap ref={ref} {...props} />
  ) : (
    <NativeChargerMap ref={ref} {...props} />
  );
});

export default React.memo(ChargerMap);
