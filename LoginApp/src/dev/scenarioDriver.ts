import type {Station, Vehicle} from '../domain/types';
import {DEFAULT_SMART_DRIVE_CONFIG} from '../intelligence/config';
import type {SmartDriveConfig} from '../intelligence/config';
import {createTrip, processEvent} from '../intelligence/monitor';
import type {
  ActiveTrip,
  Decision,
  NotificationDraft,
  TripEvent,
  TripUpdate,
  World,
} from '../intelligence/types';
import type {Path} from '../utils/path';
import {
  DELHI_JAIPUR_PATH,
  NEXON_EV,
  mockStations,
  noon,
  withStationStatus,
} from './smartDriveFixtures';

type Overlay = {status: 'occupied' | 'offline' | 'available'; queue?: number};

/**
 * Drives a Smart Drive trip through simulated time, the way a service would:
 * a FRESH snapshot of the world every step (so feeds are never stale by
 * accident), with a few presenter-style overlays on top (a charger fills up, a
 * charger dies). Used by the scenario tests.
 */
export class ScenarioDriver {
  now: number;
  trip: ActiveTrip;
  readonly told: NotificationDraft[] = [];
  readonly decisions: Decision[] = [];
  readonly events: TripEvent[] = [];
  private overlay = new Map<string, Overlay>();

  constructor(
    private readonly opts: {
      soc?: number;
      vehicle?: Vehicle;
      path?: Path;
      config?: SmartDriveConfig;
      quiet?: boolean;
      now?: number;
    } = {},
  ) {
    this.now = opts.now ?? noon();
    const path = opts.path ?? DELHI_JAIPUR_PATH;
    this.trip = createTrip({
      tripId: 'trip-scenario',
      vehicle: this.vehicle,
      origin: {label: 'Delhi', coords: path.points[0]},
      destination: {
        label: 'Jaipur',
        coords: path.points[path.points.length - 1],
      },
      polyline: path.points,
      startSoc: opts.soc ?? 72,
      now: this.now,
      world: this.world(),
      config: this.config,
    });
  }

  get vehicle(): Vehicle {
    return this.opts.vehicle ?? NEXON_EV;
  }

  get config(): SmartDriveConfig {
    return this.opts.config ?? DEFAULT_SMART_DRIVE_CONFIG;
  }

  /** A fresh snapshot, with the presenter overlays applied. */
  world(): World {
    let stations: Station[] = mockStations(this.now);
    this.overlay.forEach((o, id) => {
      stations = withStationStatus(stations, id, o.status, this.now, o.queue);
    });
    return {now: this.now, stations};
  }

  dispatch(event: TripEvent): TripUpdate {
    const update = processEvent(this.trip, event, {
      vehicle: this.vehicle,
      world: this.world(),
      config: this.config,
      quiet: this.opts.quiet,
    });
    this.trip = update.trip;
    this.told.push(...update.notifications);
    this.decisions.push(...update.decisions);
    this.events.push(...update.events);
    return update;
  }

  start(): TripUpdate {
    return this.dispatch({type: 'TRIP_STARTED', at: this.now});
  }

  tick(minutes = 0): TripUpdate {
    this.now += minutes * 60000;
    return this.dispatch({type: 'TICK', at: this.now});
  }

  /** Drive to `km` along the route in short hops, as a phone reporting GPS would. */
  driveTo(km: number, hopKm = 4): TripUpdate[] {
    const out: TripUpdate[] = [];
    while (this.trip.progressKm < km - 1e-6) {
      const next = Math.min(km, this.trip.progressKm + hopKm);
      this.now += ((next - this.trip.progressKm) / 66) * 3600000;
      out.push(
        this.dispatch({
          type: 'LOCATION_UPDATED',
          at: this.now,
          progressKm: next,
        }),
      );
    }
    return out;
  }

  /** Drive to the junction of the current primary stop. */
  driveToStop(): TripUpdate[] {
    const stop = this.trip.primaryStop;
    if (!stop) {
      throw new Error('There is no primary stop to drive to.');
    }
    return this.driveTo(stop.alongKm);
  }

  occupy(stationId: string, queue = 0): void {
    this.overlay.set(stationId, {status: 'occupied', queue});
  }

  takeOffline(stationId: string): void {
    this.overlay.set(stationId, {status: 'offline'});
  }

  restore(stationId: string): void {
    this.overlay.delete(stationId);
  }

  /** Everything said so far, as "LEVEL title" lines. */
  said(): string[] {
    return this.told.map(n => `${n.level.toUpperCase()} ${n.title}`);
  }

  titles(): string[] {
    return this.told.map(n => n.title);
  }
}
