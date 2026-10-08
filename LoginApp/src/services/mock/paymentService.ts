import {computeSessionMetrics, invoiceFor} from '../../domain/charging';
import type {
  PaymentFailureReason,
  PaymentMethod,
  SessionSummary,
} from '../../domain/types';
import {appStore} from '../../store/appStore';
import {demoStore} from '../../store/demoStore';
import type {PaymentService} from '../types';
import {ApiError} from '../types';
import {guard, uid} from './runtime';

const FAILURE_MESSAGES: Record<PaymentFailureReason, string> = {
  declined: 'Your bank declined the payment.',
  insufficient_funds: 'Not enough balance on this payment method.',
  network: 'The payment could not be completed because of a network problem.',
  bank_unavailable: 'Your bank is not responding right now.',
  no_method: 'No payment method is selected.',
};

/** Consume the presenter's "fail the next payment" switch. */
function shouldFail(): boolean {
  const mode = demoStore.get().paymentFail;
  if (mode === 'always') {
    return true;
  }
  if (mode === 'next') {
    demoStore.set({paymentFail: 'off'});
    return true;
  }
  return false;
}

export function createPaymentService(): PaymentService {
  return {
    async methods() {
      await guard(200);
      return appStore.get().paymentMethods;
    },

    async addMethod(method) {
      await guard(500);
      const created: PaymentMethod = {
        ...method,
        id: uid('pm'),
        validated: true,
        isDefault: appStore.get().paymentMethods.length === 0,
      };
      appStore.set(s => ({paymentMethods: [...s.paymentMethods, created]}));
      return created;
    },

    async setDefault(methodId) {
      await guard(150);
      appStore.set(s => ({
        paymentMethods: s.paymentMethods.map(m => ({
          ...m,
          isDefault: m.id === methodId,
        })),
      }));
    },

    async preauthorise(amountInr, methodId) {
      await guard(600);
      const method = appStore.get().paymentMethods.find(m => m.id === methodId);
      if (!method) {
        return {
          ok: false,
          reason: 'no_method',
          message: FAILURE_MESSAGES.no_method,
        };
      }
      if (!method.validated) {
        return {
          ok: false,
          reason: 'declined',
          message: 'This payment method has not been verified yet.',
        };
      }
      if (demoStore.get().paymentFail === 'always') {
        return {
          ok: false,
          reason: 'declined',
          message: FAILURE_MESSAGES.declined,
        };
      }
      return {ok: true, preauthId: uid('pa'), amountInr};
    },

    async pay(sessionId, methodId) {
      await guard(900);
      const session = appStore.get().session;
      if (!session || session.id !== sessionId) {
        throw new ApiError('This session could not be found.');
      }
      const method = appStore.get().paymentMethods.find(m => m.id === methodId);
      if (!method) {
        appStore.set({
          session: {
            ...session,
            status: 'payment_failed',
            failureReason: FAILURE_MESSAGES.no_method,
          },
        });
        return {
          ok: false,
          reason: 'no_method',
          message: FAILURE_MESSAGES.no_method,
        };
      }

      if (shouldFail()) {
        const reason: PaymentFailureReason = 'declined';
        const message = FAILURE_MESSAGES[reason];
        appStore.set({
          session: {
            ...session,
            paymentMethodId: methodId,
            status: 'payment_failed',
            failureReason: message,
          },
        });
        return {ok: false, reason, message};
      }

      const stoppedAt = session.stoppedAt ?? Date.now();
      const frozen = {...session, stoppedAt};
      const metrics = computeSessionMetrics(frozen, stoppedAt);
      const invoice = invoiceFor(metrics.energyKwh, session.pricePerKwh);
      const receiptNo = `RC-${new Date(stoppedAt).getFullYear()}-${session.id
        .replace('PO-', '')
        .padStart(8, '0')}`;
      const summary: SessionSummary = {
        id: session.id,
        stationName: session.stationName,
        startedAt: session.startedAt,
        energyKwh: invoice.energyKwh,
        durationMin: Math.max(1, Math.round(metrics.elapsedMin)),
        costInr: invoice.totalInr,
        receiptNo,
        status: 'paid',
        startSoc: session.startSoc,
        endSoc: Math.round(metrics.socPercent),
        connectorLabel: session.connectorLabel,
        powerKw: session.powerKw,
        pricePerKwh: session.pricePerKwh,
      };
      appStore.set(s => ({
        session: null,
        history: [summary, ...s.history],
        battery: s.battery
          ? {...s.battery, percent: summary.endSoc, updatedAt: Date.now()}
          : s.battery,
      }));
      return {ok: true, receiptNo, chargedInr: invoice.totalInr};
    },
  };
}
