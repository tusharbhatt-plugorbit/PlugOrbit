import {Linking} from 'react-native';

type Target = {id: string; latitude: number; longitude: number};

// Google Maps URLs API: opens the Google Maps app when installed, otherwise the
// browser. No API key needed.
// https://developers.google.com/maps/documentation/urls/get-started#directions-action
export function directionsUrl(target: Target): string {
  const destination = `${target.latitude},${target.longitude}`;
  const params = [
    'api=1',
    `destination=${encodeURIComponent(destination)}`,
    'travelmode=driving',
  ];
  // Only Google Places ids (prefixed g-) are real place ids; mock stations aren't.
  if (target.id.startsWith('g-')) {
    params.push(
      `destination_place_id=${encodeURIComponent(target.id.slice(2))}`,
    );
  }
  return `https://www.google.com/maps/dir/?${params.join('&')}`;
}

export async function openDirections(target: Target): Promise<boolean> {
  try {
    await Linking.openURL(directionsUrl(target));
    return true;
  } catch {
    return false;
  }
}
