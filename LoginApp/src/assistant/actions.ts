import { compatibleConnectors } from '../domain/rules';
import type { Navigation } from '../navigation/NavigationContext';
import { ApiError, OfflineError } from '../services/types';
import { cacheRoute } from '../store/tripActions';
import { describeError } from '../domain/describeError';
import { assistantStore, patchJourney, savePreference } from './store';
import { ToolDeps, buildRequest, isEnvelope } from './tools/common';
import type { AssistantAction, PreferenceKey } from './types';

/**
 * Carries out an action the driver approved, using the app's own services and
 * screens. It reports exactly what happened: `completed` only when the work was
 * done, `unavailable` when this app cannot do it, `failed` when it tried and
 * could not. Nothing here pays, books, starts or stops charging, or changes the
 * destination without the tap that called it.
 */

export type ActionOutcome = {
  status: 'completed' | 'failed' | 'unavailable';
  message: string;
};

export type ActionDeps = {
  tools: ToolDeps;
  getNav: () => Navigation | null;
};

const done = (message: string): ActionOutcome => ({
  status: 'completed',
  message,
});
const failed = (message: string): ActionOutcome => ({
  status: 'failed',
  message,
});
const unavailable = (message: string): ActionOutcome => ({
  status: 'unavailable',
  message,
});

const text = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

async function stationOrNull(deps: ActionDeps, id: string) {
  try {
    return await deps.tools.services.station.get(id);
  } catch (e) {
    if (e instanceof OfflineError) {
      throw e;
    }
    return null;
  }
}

export async function performAction(
  action: AssistantAction,
  deps: ActionDeps,
  options: { consent?: boolean } = {},
): Promise<ActionOutcome> {
  const nav = deps.getNav();
  if (!nav) {
    return unavailable('The app isn’t ready to open that screen.');
  }
  const p = action.params;
  try {
    switch (action.kind) {
      case 'view_route': {
        const ctx = await buildRequest(deps.tools, {
          destination: p.destination,
          origin: p.origin,
          strategy: p.strategy,
        });
        if (isEnvelope(ctx)) {
          return unavailable(
            ctx.message ?? 'That route can’t be planned right now.',
          );
        }
        const route = await deps.tools.services.route.plan(ctx.request);
        cacheRoute(route, 0);
        nav.navigate('RouteResult');
        return done(`Opened the route to ${route.toLabel}.`);
      }

      case 'compare_chargers': {
        const ids = Array.isArray(p.station_ids)
          ? p.station_ids
              .filter((x): x is string => typeof x === 'string')
              .slice(0, 4)
          : [];
        if (ids.length < 2) {
          return failed('Pick at least two chargers to compare.');
        }
        for (const id of ids) {
          if (!(await stationOrNull(deps, id))) {
            return failed('One of those chargers isn’t available any more.');
          }
        }
        nav.navigate('Compare', { stationIds: ids });
        return done('Opened the comparison.');
      }

      case 'view_charger': {
        const id = text(p.station_id);
        const s = id ? await stationOrNull(deps, id) : null;
        if (!id || !s) {
          return failed('That charger isn’t available right now.');
        }
        nav.navigate('StationDetail', { stationId: id });
        return done(`Opened ${s.name}.`);
      }

      case 'start_navigation': {
        const id = text(p.station_id);
        const s = id ? await stationOrNull(deps, id) : null;
        if (!id || !s) {
          return failed('That charger isn’t available right now.');
        }
        nav.navigate('Navigation', { stationId: id });
        return done(`Opened directions to ${s.name}.`);
      }

      case 'open_charging_screen': {
        const id = text(p.station_id);
        const s = id ? await stationOrNull(deps, id) : null;
        if (!id || !s) {
          return failed('That charger isn’t available right now.');
        }
        const vehicle = deps.tools
          .getState()
          .vehicles.find(v => v.id === deps.tools.getState().activeVehicleId);
        const fits = compatibleConnectors(s, vehicle ?? null);
        const connector = fits.find(c => c.status === 'available') ?? fits[0];
        if (s.integration !== 'integrated' || !connector) {
          nav.navigate('StationDetail', { stationId: id });
          return unavailable(
            s.integration !== 'integrated'
              ? 'PlugOrbit can’t start charging at this charger. I opened its details with the operator’s steps.'
              : 'No connector for your car is listed here. I opened the charger details.',
          );
        }
        // The screen opened here asks for payment confirmation itself.
        nav.navigate('StartCharging', {
          stationId: id,
          connectorId: connector.id,
        });
        return done('Opened the charging screen. You confirm and pay there.');
      }

      case 'start_journey': {
        const ctx = await buildRequest(deps.tools, {
          destination: p.destination,
          origin: p.origin,
          start_soc_percent: p.start_soc_percent,
        });
        if (isEnvelope(ctx)) {
          return unavailable(
            ctx.message ?? 'That journey can’t be started right now.',
          );
        }
        const trip = await deps.tools.services.smartDrive.start({
          fromLabel: ctx.request.fromLabel,
          toLabel: ctx.request.toLabel,
          fromCoords:ctx.request.fromCoords, toCoords:ctx.request.toCoords,
          reservePct: ctx.request.safetyReservePct,
          strategy: ctx.request.strategy,
          ...(typeof p.start_soc_percent === 'number'
            ? { startSoc: p.start_soc_percent }
            : {}),
        });
        patchJourney({
          destination: trip.destination.label,
          origin: trip.origin.label,
        });
        nav.navigate('SmartDrive', { toLabel: trip.destination.label });
        return done(
          `Journey to ${trip.destination.label} is planned. Open it to set off.`,
        );
      }

      case 'switch_charger': {
        const id = text(p.station_id);
        const trip = deps.tools.getState().smartDrive.trip;
        if (!id) {
          return failed('Which charger?');
        }
        if (!trip || trip.monitoringState === 'ended') {
          return unavailable('There’s no journey in progress to change.');
        }
        const update = await deps.tools.services.smartDrive.switchTo(id);
        const stop = update.trip.plan.primary?.station;
        if (stop) {
          patchJourney({
            selected_station_id: stop.id,
            selected_station_name: stop.name,
          });
        }
        return done(
          `Switched your planned stop to ${stop?.name ?? 'the new charger'}.`,
        );
      }

      case 'save_preference': {
        const key = text(p.key) as PreferenceKey | undefined;
        const value = p.value;
        if (!key || (typeof value !== 'string' && typeof value !== 'number')) {
          return failed('That preference isn’t valid.');
        }
        const state = deps.tools.getState();
        if (key === 'min_arrival_soc_pct' && typeof value === 'number') {
          await deps.tools.services.preferences.setTripPreferences({
            ...state.tripPrefs,
            minArrivalSocPct: value,
          });
          patchJourney({ min_arrival_soc_pct: value });
          return done(`Your arrival reserve is now ${value}%.`);
        }
        if (
          key === 'strategy' &&
          (value === 'fastest' || value === 'cheapest' || value === 'reliable')
        ) {
          await deps.tools.services.preferences.setTripPreferences({
            ...state.tripPrefs,
            strategy: value,
          });
          patchJourney({ strategy: value });
          return done(`Your route priority is now ${value}.`);
        }
        if (!assistantStore.get().settings.rememberPreferences) {
          if (!options.consent) {
            return unavailable(
              'Allow Orbit to remember preferences on this phone to save this.',
            );
          }
          assistantStore.set(s => ({
            settings: { ...s.settings, rememberPreferences: true },
          }));
        }
        if (!savePreference(key, String(value))) {
          return failed('Couldn’t save that preference.');
        }
        return done(
          'Saved on this phone. You can clear it in Assistant settings.',
        );
      }
    }
  } catch (e) {
    if (e instanceof ApiError || e instanceof OfflineError) {
      return failed(e.message);
    }
    return failed(describeError(e, 'That didn’t work.').body);
  }
  return unavailable('This app can’t do that.');
}
