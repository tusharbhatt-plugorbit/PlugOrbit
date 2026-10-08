import type {SmartDrivePrefs} from '../../domain/coDriver';
import type {
  AlertPreferences,
  PrivacyPreferences,
  Ticket,
  TripPreferences,
  Vehicle,
} from '../../domain/types';
import {appStore} from '../../store/appStore';
import {onBatteryEdited} from '../../store/tripCoordinator';
import type {
  NotificationService,
  PreferencesService,
  SupportService,
  VehicleService,
} from '../types';
import {ApiError} from '../types';
import {VEHICLE_CATALOG} from './data';
import {guard, uid} from './runtime';

export function createVehicleService(): VehicleService {
  return {
    async catalog() {
      await guard(250);
      return VEHICLE_CATALOG;
    },

    async save(input) {
      await guard(350);
      const vehicle: Vehicle = {...input, id: input.id ?? uid('veh')};
      appStore.set(s => {
        const exists = s.vehicles.some(v => v.id === vehicle.id);
        return {
          vehicles: exists
            ? s.vehicles.map(v => (v.id === vehicle.id ? vehicle : v))
            : [...s.vehicles, vehicle],
          activeVehicleId: vehicle.id,
        };
      });
      return vehicle;
    },

    async setActive(vehicleId) {
      await guard(100);
      appStore.set({activeVehicleId: vehicleId});
    },

    async remove(vehicleId) {
      await guard(200);
      appStore.set(s => {
        const vehicles = s.vehicles.filter(v => v.id !== vehicleId);
        return {
          vehicles,
          activeVehicleId:
            s.activeVehicleId === vehicleId
              ? vehicles[0]?.id ?? null
              : s.activeVehicleId,
        };
      });
    },

    async setBattery(percent) {
      await guard(150);
      const reading = {
        percent: Math.min(100, Math.max(0, Math.round(percent))),
        source: 'manual' as const,
        updatedAt: Date.now(),
      };
      appStore.set({battery: reading});
      // A trip under way re-plans from the corrected level.
      onBatteryEdited(reading.percent);
      return reading;
    },

    async connectVehicle(method) {
      await guard(1400);
      // TODO(integration): OEM cloud account / Bluetooth OBD dongle.
      const reading = {
        percent: 58,
        source: 'vehicle' as const,
        updatedAt: Date.now(),
      };
      appStore.set({battery: reading, vehicleLink: {connected: true, method}});
      return reading;
    },

    async disconnectVehicle() {
      await guard(200);
      appStore.set({vehicleLink: {connected: false, method: null}});
    },
  };
}

export function createSupportService(): SupportService {
  return {
    async createTicket(input) {
      await guard(600);
      const now = Date.now();
      const ticket: Ticket = {
        id: uid('tk'),
        number: `PO-${143 + appStore.get().tickets.length}`,
        category: input.category,
        title: input.title,
        status: 'open',
        linkedSessionId: input.linkedSessionId,
        createdAt: now,
        updatedAt: now,
        messages: [{id: uid('m'), from: 'user', text: input.message, at: now}],
      };
      appStore.set(s => ({tickets: [ticket, ...s.tickets]}));
      return ticket;
    },

    async reply(ticketId, text) {
      await guard(300);
      const found = appStore.get().tickets.find(t => t.id === ticketId);
      if (!found) {
        throw new ApiError('This ticket could not be found.');
      }
      const now = Date.now();
      const updated: Ticket = {
        ...found,
        updatedAt: now,
        messages: [
          ...found.messages,
          {id: uid('m'), from: 'user', text, at: now},
        ],
      };
      appStore.set(s => ({
        tickets: s.tickets.map(t => (t.id === ticketId ? updated : t)),
      }));
      return updated;
    },
  };
}

export function createNotificationService(): NotificationService {
  return {
    async markRead(id) {
      await guard(60);
      appStore.set(s => ({
        notifications: s.notifications.map(n =>
          n.id === id ? {...n, read: true} : n,
        ),
      }));
    },
    async markAllRead() {
      await guard(100);
      appStore.set(s => ({
        notifications: s.notifications.map(n => ({...n, read: true})),
      }));
    },
  };
}

export function createPreferencesService(): PreferencesService {
  return {
    async setTripPreferences(prefs: TripPreferences) {
      await guard(150);
      appStore.set({tripPrefs: prefs});
    },
    async setAlerts(prefs: AlertPreferences) {
      await guard(100);
      appStore.set({alertPrefs: prefs});
    },
    async setSmartDrive(prefs: SmartDrivePrefs) {
      await guard(100);
      appStore.set({smartDrivePrefs: prefs});
    },
    async setPrivacy(prefs: PrivacyPreferences) {
      await guard(100);
      appStore.set({privacy: prefs});
    },
    async setPlus(active: boolean) {
      await guard(600);
      appStore.set({plus: {active, since: active ? Date.now() : null}});
    },
    async eraseHistory() {
      await guard(500);
      appStore.set({history: [], tickets: [], notifications: []});
    },
  };
}
