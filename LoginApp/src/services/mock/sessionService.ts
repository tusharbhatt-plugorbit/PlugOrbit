import {estimatePreauthInr, computeSessionMetrics} from '../../domain/charging';
import {compatibleConnectors, effectivePowerKw} from '../../domain/rules';
import type {ChargingSession} from '../../domain/types';
import {appStore, getActiveVehicle} from '../../store/appStore';
import {demoStore} from '../../store/demoStore';
import type {SessionService} from '../types';
import {ApiError, IntegrationUnavailableError} from '../types';
import {guard, uid} from './runtime';
import {createPaymentService} from './paymentService';
import {loadStations} from './stationService';

/** Thrown when remote start is refused for a payment reason. */
export class PaymentRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentRequiredError';
  }
}

export class ConnectorUnavailableError extends Error {
  constructor(message = 'This connector just became unavailable.') {
    super(message);
    this.name = 'ConnectorUnavailableError';
  }
}

export function createSessionService(): SessionService {
  const payments = createPaymentService();

  return {
    async start(input) {
      await guard(400);
      const vehicle = getActiveVehicle();
      if (!vehicle) {
        throw new ApiError('Add your vehicle before charging.');
      }
      const station = loadStations().find(s => s.id === input.stationId);
      const connector = station?.connectors.find(
        c => c.id === input.connectorId,
      );
      if (!station || !connector) {
        throw new ApiError('This charger could not be found.');
      }

      // PlugOrbit only controls sessions on integrated stations, and only when
      // the operator link is up. Otherwise we hand over to the operator's flow.
      if (
        station.integration !== 'integrated' ||
        demoStore.get().integrationDown
      ) {
        throw new IntegrationUnavailableError(
          station.operatorInstructions ??
            'Remote start is unavailable right now. Start this charger with the operator’s own app or QR code.',
        );
      }
      if (
        !compatibleConnectors(station, vehicle).some(c => c.id === connector.id)
      ) {
        throw new ApiError('This connector does not fit your vehicle.');
      }
      if (connector.status !== 'available') {
        throw new ConnectorUnavailableError(
          connector.status === 'offline'
            ? 'This connector is offline.'
            : 'This connector is occupied.',
        );
      }
      if (connector.pricePerKwh === null) {
        throw new ApiError(
          'The operator has not published a price for this connector.',
        );
      }

      const method = appStore
        .get()
        .paymentMethods.find(m => m.id === input.paymentMethodId);
      if (!method || !method.validated) {
        throw new PaymentRequiredError(
          'Add a verified payment method before starting. We hold an amount first and only charge what you use.',
        );
      }

      const startSoc = Math.round(appStore.get().battery?.percent ?? 40);
      const powerKw = effectivePowerKw(connector, vehicle);
      const amount = estimatePreauthInr(
        startSoc,
        input.targetSoc,
        vehicle.batteryKwh,
        connector.pricePerKwh,
      );

      // Persist the intent first, so a crash mid-authorisation is recoverable.
      const pending: ChargingSession = {
        id: `PO-${uid('s').slice(-6).toUpperCase()}`,
        stationId: station.id,
        stationName: station.name,
        connectorId: connector.id,
        connectorLabel: `${connector.label} • ${connector.type}`,
        connectorType: connector.type,
        powerKw,
        pricePerKwh: connector.pricePerKwh,
        batteryKwh: vehicle.batteryKwh,
        startSoc,
        targetSoc: input.targetSoc,
        startedAt: Date.now(),
        stoppedAt: null,
        status: 'authorising',
        paymentMethodId: method.id,
        preauthId: null,
        preauthAmountInr: amount,
        receiptNo: null,
        failureReason: null,
      };
      appStore.set({session: pending});

      const result = await payments.preauthorise(amount, method.id);
      if (!result.ok) {
        appStore.set({session: null});
        throw new PaymentRequiredError(result.message);
      }

      const active: ChargingSession = {
        ...pending,
        status: 'active',
        preauthId: result.preauthId,
        startedAt: Date.now(),
      };
      appStore.set({session: active});
      return active;
    },

    async stop(sessionId) {
      await guard(300);
      const session = appStore.get().session;
      if (!session || session.id !== sessionId) {
        throw new ApiError('This session is no longer active.');
      }
      if (session.status !== 'active') {
        return session;
      }
      const stopped: ChargingSession = {
        ...session,
        stoppedAt: Date.now(),
        status: 'payment_due',
      };
      appStore.set({session: stopped});
      return stopped;
    },

    async cancelPending() {
      const session = appStore.get().session;
      if (session && session.status === 'authorising') {
        // The authorisation never completed: release the hold, drop the session.
        appStore.set({session: null});
      }
    },

    async feedback(sessionId) {
      await guard(300);
      appStore.set(s => ({feedbackDone: [...s.feedbackDone, sessionId]}));
    },
  };
}

export {computeSessionMetrics};
