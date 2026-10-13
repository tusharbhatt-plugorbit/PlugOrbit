import {googleApiKey} from '../config/google';
import {googleRequestIdentityHeaders} from './googleRequestIdentity';
import type {Coords} from '../utils/geo';

export type AddressChoice = {id: string; label: string; coords: Coords};
export async function searchAddresses(query: string, signal?: AbortSignal): Promise<AddressChoice[]> {
  if (!googleApiKey || query.trim().length < 3) return [];
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel);
  if (signal?.aborted) cancel();
  const timer = setTimeout(cancel, 12000);
  try {
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST', signal: controller.signal,
      headers: {...googleRequestIdentityHeaders(), 'Content-Type': 'application/json',
        'X-Goog-Api-Key': googleApiKey,
        'X-Goog-FieldMask': 'places.id,places.formattedAddress,places.location'},
      body: JSON.stringify({textQuery: query.trim(), regionCode: 'IN', pageSize: 5}),
    });
    if (!response.ok) throw new Error('Address search is unavailable. Try again or choose a suggested city.');
    const body = await response.json();
    return (body.places ?? []).flatMap((p: {id?: string; formattedAddress?: string; location?: Coords}) => {
      const c = p.location;
      return p.id && p.formattedAddress && c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude)
        && Math.abs(c.latitude) <= 90 && Math.abs(c.longitude) <= 180
        ? [{id: p.id, label: p.formattedAddress, coords: c}] : [];
    });
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', cancel);
  }
}
