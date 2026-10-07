import type {
  AppNotification,
  PaymentMethod,
  SavedRoute,
  SessionSummary,
  Ticket,
} from '../domain/types';
import type {AppState} from './appStore';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * First-launch demo content (the "account already has history" look). This is
 * mock data: a real backend replaces it with the signed-in user's records.
 */
export function seedState(now: number): Partial<AppState> {
  const history: SessionSummary[] = [
    {
      id: 'PO-6A4K92',
      stationName: 'ChargeZone • Neemrana',
      startedAt: now - 2 * DAY - 3 * HOUR,
      energyKwh: 26.2,
      durationMin: 41,
      costInr: 556.49,
      receiptNo: 'RC-2024-006A4K92',
      status: 'paid',
      startSoc: 22,
      endSoc: 80,
      connectorLabel: 'C2 • CCS2',
      powerKw: 60,
      pricePerKwh: 18,
    },
    {
      id: 'PO-3M8T17',
      stationName: 'Tata Power • Gurgaon',
      startedAt: now - 9 * DAY,
      energyKwh: 18.9,
      durationMin: 33,
      costInr: 381.36,
      receiptNo: 'RC-2024-003M8T17',
      status: 'paid',
      startSoc: 31,
      endSoc: 78,
      connectorLabel: 'C1 • CCS2',
      powerKw: 50,
      pricePerKwh: 17.1,
    },
    {
      id: 'PO-9X2D45',
      stationName: 'Statiq • Jaipur Bypass',
      startedAt: now - 21 * DAY,
      energyKwh: 31.4,
      durationMin: 52,
      costInr: 641,
      receiptNo: 'RC-2024-009X2D45',
      status: 'paid',
      startSoc: 15,
      endSoc: 82,
      connectorLabel: 'C3 • CCS2',
      powerKw: 60,
      pricePerKwh: 17.3,
    },
  ];

  const tickets: Ticket[] = [
    {
      id: 'tk-142',
      number: 'PO-142',
      category: 'payment',
      title: 'Charged twice for one session',
      status: 'in_review',
      linkedSessionId: 'PO-3M8T17',
      createdAt: now - 3 * DAY,
      updatedAt: now - 5 * HOUR,
      messages: [
        {
          id: 'm1',
          from: 'user',
          text: 'I see two debits for my Gurgaon session on the 9th.',
          at: now - 3 * DAY,
        },
        {
          id: 'm2',
          from: 'support',
          text: 'Thanks for flagging this. We found the duplicate pre-authorisation and have asked your bank to release it. This usually takes 3-5 working days.',
          at: now - 5 * HOUR,
        },
      ],
    },
  ];

  const notifications: AppNotification[] = [
    {
      id: 'n1',
      title: 'Charger ready',
      body: 'Statiq • Highway Hub has a free CCS2 bay now.',
      at: now - 12 * MIN,
      read: false,
      target: {route: 'StationDetail', params: {stationId: 'st-statiq-bawal'}},
    },
    {
      id: 'n2',
      title: '80% reached',
      body: 'Your last session hit 80%. Idle fees start after 10 minutes.',
      at: now - 2 * DAY,
      read: true,
      target: null,
    },
    {
      id: 'n3',
      title: 'Refund initiated',
      body: '₹381.36 is on its way back to your UPI account.',
      at: now - 5 * HOUR,
      read: false,
      target: {route: 'TicketDetail', params: {ticketId: 'tk-142'}},
    },
    {
      id: 'n4',
      title: 'Saved route changed',
      body: 'Delhi → Jaipur: a station on your route went offline. Backup applied.',
      at: now - 1 * DAY,
      read: true,
      target: {route: 'Saved'},
    },
  ];

  const paymentMethods: PaymentMethod[] = [
    {
      id: 'pm-upi',
      kind: 'upi',
      label: 'UPI',
      detail: '•••• 2481',
      validated: true,
      isDefault: true,
    },
    {
      id: 'pm-card',
      kind: 'card',
      label: 'Visa',
      detail: '•••• 4242',
      validated: true,
      isDefault: false,
    },
    {
      id: 'pm-wallet',
      kind: 'wallet',
      label: 'PlugOrbit Wallet',
      detail: '₹250 balance',
      validated: false,
      isDefault: false,
    },
  ];

  const savedRoutes: SavedRoute[] = [
    {
      id: 'sr-1',
      fromLabel: 'Delhi',
      toLabel: 'Jaipur',
      strategy: 'reliable',
      savedAt: now - 6 * DAY,
    },
  ];

  return {
    history,
    tickets,
    notifications,
    paymentMethods,
    savedRoutes,
    favouriteStationIds: ['st-chargezone-neemrana'],
  };
}
