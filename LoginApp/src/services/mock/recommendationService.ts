import {recommend, Recommendation} from '../../domain/recommendation';
import {getActiveVehicle} from '../../store/appStore';
import {appStore} from '../../store/appStore';
import {demoStore} from '../../store/demoStore';
import type {RecommendationService} from '../types';
import {ApiError} from '../types';
import {createStationService, waitFor} from './stationService';

/** Typical speed in town, for turning km into minutes on a nearby search. */
const NEARBY_SPEED_KMH = 40;

/**
 * Mock recommendation service: the real decision engine over the mock station
 * service. Swapping in a backend means replacing the station data (live
 * operator feeds) and, later, the scoring weights, not this wiring.
 */
export function createRecommendationService(): RecommendationService {
  const stations = createStationService();
  return {
    async recommend({intent, origin, targetSoc}): Promise<Recommendation> {
      const vehicle = getActiveVehicle();
      if (!vehicle) {
        throw new ApiError(
          'Add your car first so we can pick a charger that suits it.',
        );
      }
      const battery = appStore.get().battery;
      if (!battery) {
        throw new ApiError(
          'Tell us your battery level first so we know what you can reach.',
        );
      }
      // Everything, including chargers that don't fit: the engine records WHY a
      // charger was left out, so the screen can say "3 don't fit your car".
      const nearby = await stations.nearby({
        origin,
        vehicle,
        includeIncompatible: true,
      });
      const now = Date.now();
      const result = recommend(
        nearby.map(station => ({station})),
        {
          intent,
          vehicle,
          socPercent: battery.percent,
          reservePct: appStore.get().tripPrefs.minArrivalSocPct,
          now,
          speedKmh: NEARBY_SPEED_KMH,
          targetSoc,
          waitOf: (s, v) => waitFor(s, v, now),
        },
      );
      // The presenter's "no compatible chargers" switch empties the search; say
      // so in the right words rather than "nothing nearby".
      return demoStore.get().noCompatible && result.status === 'no_candidates'
        ? {...result, status: 'none_compatible'}
        : result;
    },
  };
}
