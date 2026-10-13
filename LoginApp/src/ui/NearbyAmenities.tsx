import React, {useEffect, useState} from 'react';
import {Linking, StyleSheet, Text, View} from 'react-native';
import {useAppearance} from '../appearance';
import type {Station} from '../domain/types';
import {googleApiKey} from '../config/google';
import {googleRequestIdentityHeaders} from '../services/googleRequestIdentity';
import {distanceKm} from '../utils/geo';
import {Card, KeyValue} from './Card';
import {Chip} from './Fields';
import {TextButton} from './Buttons';
import {showToast} from './Toast';

type Place = {id: string; name: string; address: string; latitude: number; longitude: number; km: number};
const OPTIONS = [{label: 'Cafes', query: 'cafes'}, {label: 'Food', query: 'restaurants'}, {label: 'Restrooms', query: 'public toilets'}, {label: 'Shopping', query: 'shops'}, {label: 'Parking', query: 'parking'}, {label: 'Wi-Fi', query: 'cafes with Wi-Fi'}];
export function NearbyAmenities({station, initialQuery}: {station: Station; initialQuery?: string}) {
  const {colors} = useAppearance();
  const [selected, setSelected] = useState(initialQuery ?? '');
  useEffect(() => {if (initialQuery) setSelected(initialQuery);}, [initialQuery]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!selected) return;
    const abort = new AbortController(); let alive = true;
    const timer = setTimeout(() => abort.abort(), 12000);
    setBusy(true); setError(''); setPlaces([]);
    (async () => {
      if (!googleApiKey) throw new Error('Nearby place search is not configured.');
      const response = await fetch('https://places.googleapis.com/v1/places:searchText', {method: 'POST', signal: abort.signal,
        headers: {...googleRequestIdentityHeaders(), 'Content-Type': 'application/json', 'X-Goog-Api-Key': googleApiKey,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location'},
        body: JSON.stringify({textQuery: `${selected} near ${station.name}, ${station.address}`, regionCode: 'IN', pageSize: 10,
          ...(['cafes','restaurants'].includes(selected) ? {includedType: selected === 'cafes' ? 'cafe' : 'restaurant', strictTypeFiltering: true} : {}),
          locationBias: {circle: {center: {latitude: station.latitude, longitude: station.longitude}, radius: 2500}}})});
      if (!response.ok) throw new Error('Could not load nearby places. Check your connection and retry.');
      const data = await response.json();
      const list: Place[] = (data.places ?? []).flatMap((p: {id?: string; displayName?: {text?: string}; formattedAddress?: string; location?: {latitude: number; longitude: number}}) => {
        if (!p.id || !p.displayName?.text || !p.location || !Number.isFinite(p.location.latitude) || !Number.isFinite(p.location.longitude)) return [];
        const km = distanceKm({latitude: station.latitude, longitude: station.longitude}, p.location);
        return km <= 5 ? [{id: p.id, name: p.displayName.text, address: p.formattedAddress ?? 'Address not published', ...p.location, km}] : [];
      }).sort((a: Place,b: Place) => a.km-b.km);
      if (alive) setPlaces(list);
    })().catch(e => {if (alive) setError(e instanceof Error ? e.message : 'Could not load places.');})
      .finally(() => {clearTimeout(timer); if (alive) setBusy(false);});
    return () => {alive = false; clearTimeout(timer); abort.abort();};
  }, [selected, station.address, station.latitude, station.longitude, station.name]);
  return <View style={styles.stack}>
    <View style={styles.chips}>{OPTIONS.map(o => <Chip key={o.query} label={o.label} selected={selected===o.query} onPress={() => setSelected(o.query)} />)}</View>
    {!selected && <Text style={{color: colors.muted}}>Choose an amenity to see nearby places on Google Maps.</Text>}
    {busy && <Text style={{color: colors.muted}}>Finding nearby places...</Text>}
    {!!error && <Text accessibilityRole="alert" style={{color: colors.danger}}>{error}</Text>}
    {selected && !busy && !error && places.length===0 && <Text style={{color: colors.muted}}>No matching places found within 5 km.</Text>}
    {places.map(p => <Card key={p.id}><Text style={[styles.name,{color: colors.ink}]}>{p.name}</Text><Text style={{color: colors.muted, lineHeight: 21}}>{p.address}</Text>
      <KeyValue label="Distance from charger" value={`${p.km.toFixed(1)} km`} last />
      <TextButton label="Open in Maps" icon="navigation" onPress={async () => {
        try {await Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${p.latitude},${p.longitude}&query_place_id=${encodeURIComponent(p.id)}`);}
        catch {showToast('Could not open Google Maps.', 'warn');}
      }} /></Card>)}
    {selected && <Text style={{color: colors.muted,fontSize: 12}}>Google Maps results. Nearby businesses may not be amenities provided by the charger; verify opening hours and access.</Text>}
  </View>;
}
const styles = StyleSheet.create({stack: {gap: 12}, chips: {flexDirection: 'row',flexWrap: 'wrap',gap: 8},name: {fontSize: 16,fontWeight: '700',marginBottom: 8}});
