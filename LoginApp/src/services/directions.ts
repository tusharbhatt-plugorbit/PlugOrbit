import {Linking} from 'react-native';
import type {Charger} from '../data/chargers';

// Google Maps URLs API: opens the Google Maps app when installed, otherwise the
// browser. No API key needed.
// https://developers.google.com/maps/documentation/urls/get-started#directions-action
export function directionsUrl(charger: Charger): string {
  const destination = `${charger.latitude},${charger.longitude}`;
  const params = [
    'api=1',
    `destination=${encodeURIComponent(destination)}`,
    'travelmode=driving',
  ];
  if (!charger.id.startsWith('demo-')) {
    params.push(`destination_place_id=${encodeURIComponent(charger.id)}`);
  }
  return `https://www.google.com/maps/dir/?${params.join('&')}`;
}

export async function openDirections(charger: Charger): Promise<boolean> {
  try {
    await Linking.openURL(directionsUrl(charger));
    return true;
  } catch {
    return false;
  }
}
