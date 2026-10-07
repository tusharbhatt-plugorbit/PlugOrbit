import type {Station, StationConnector} from './types';

/**
 * The code printed under a charger's QR, e.g. "CHARGEZONE-NEEMRANA-C2": the
 * station slug plus the connector label. TODO(integration): replace with the
 * operator's real QR payload format.
 */
export function chargerCode(
  station: Pick<Station, 'id'>,
  connector: Pick<StationConnector, 'label'>,
): string {
  const slug = station.id.replace(/^st-/, '').toUpperCase();
  return `${slug}-${connector.label.toUpperCase()}`;
}

export type ResolvedCharger = {station: Station; connector: StationConnector};

function normalise(text: string): string {
  return text
    .trim()
    .toUpperCase()
    .replace(/[\s_/]+/g, '-')
    .replace(/-+/g, '-');
}

/** Match typed or scanned text to a connector, ignoring case and spacing. */
export function resolveChargerCode(
  input: string,
  stations: readonly Station[],
): ResolvedCharger | null {
  const wanted = normalise(input);
  if (!wanted) {
    return null;
  }
  for (const station of stations) {
    for (const connector of station.connectors) {
      if (normalise(chargerCode(station, connector)) === wanted) {
        return {station, connector};
      }
      // The full connector id also works (what a deep link would carry).
      if (normalise(connector.id.replace(/^st-/, '')) === wanted) {
        return {station, connector};
      }
    }
  }
  return null;
}
