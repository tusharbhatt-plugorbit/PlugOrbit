import type {Navigation} from '../navigation/NavigationContext';
import type {RouteName, TabName} from '../navigation/params';
import {appStore, AppState} from '../store/appStore';

export type InitialRoute = {name: RouteName; params?: unknown};

export type BootPlan = {
  /** Tab to show first (default Home). */
  tab?: TabName;
  stack: InitialRoute[];
  /** A message to show once, explaining why we opened somewhere unusual. */
  toast: {message: string; tone: 'info' | 'warn'} | null;
  /** Clean up a half-finished start before showing anything. */
  cancelPendingSession: boolean;
};

/**
 * Decide where a cold start should land. This is what makes an interrupted
 * charging or payment flow recoverable after the app is killed:
 *  - authorising: the start never completed -> drop it, nothing was charged
 *  - active:      back to the live session
 *  - payment_due / payment_failed: straight to payment, never silently lost
 * Otherwise: onboarding if there is no vehicle/battery, else Home.
 */
export function planBoot(state: AppState): BootPlan {
  const {session} = state;

  if (session?.status === 'authorising') {
    return {
      stack: [],
      cancelPendingSession: true,
      toast: {
        message:
          'An unfinished charger start was cancelled. You weren’t charged.',
        tone: 'info',
      },
    };
  }
  if (session?.status === 'active') {
    return {
      stack: [{name: 'ActiveSession'}],
      cancelPendingSession: false,
      toast: {message: 'Restored your charging session.', tone: 'info'},
    };
  }
  if (session?.status === 'payment_due' || session?.status === 'stopped') {
    return {
      stack: [{name: 'Payment', params: {sessionId: session.id}}],
      cancelPendingSession: false,
      toast: {message: 'Your session ended. Payment is waiting.', tone: 'warn'},
    };
  }
  if (session?.status === 'payment_failed') {
    return {
      stack: [{name: 'PaymentFailure', params: {sessionId: session.id}}],
      cancelPendingSession: false,
      toast: {message: 'Your last payment didn’t go through.', tone: 'warn'},
    };
  }

  if (state.vehicles.length === 0) {
    return {
      stack: [{name: 'VehicleSetup', params: {onboarding: true}}],
      cancelPendingSession: false,
      toast: null,
    };
  }
  if (!state.battery) {
    return {
      stack: [{name: 'ManualSoc', params: {onboarding: true}}],
      cancelPendingSession: false,
      toast: null,
    };
  }
  return {stack: [], cancelPendingSession: false, toast: null};
}

/** Where tapping the "session in progress" banner should go. */
export function sessionTarget(state: AppState): InitialRoute | null {
  const s = state.session;
  if (!s) {
    return null;
  }
  switch (s.status) {
    case 'active':
    case 'authorising':
      return {name: 'ActiveSession'};
    case 'payment_failed':
      return {name: 'PaymentFailure', params: {sessionId: s.id}};
    default:
      return {name: 'Payment', params: {sessionId: s.id}};
  }
}

/**
 * Open the screen an unfinished session belongs on, WITH its params (Payment
 * and PaymentFailure need the session id). Used by the banner and the Charge
 * and Activity tabs so they can never disagree.
 */
export function resumeSession(nav: Navigation): void {
  const target = sessionTarget(appStore.get());
  if (target) {
    (nav.navigate as (name: RouteName, params?: unknown) => void)(
      target.name,
      target.params,
    );
  }
}
