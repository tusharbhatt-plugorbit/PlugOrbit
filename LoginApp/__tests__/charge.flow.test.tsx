/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {planBoot} from '../src/app/initialStack';
import {
  liveSession,
  TestApp,
  probe,
  seedSignedIn,
} from '../src/dev/testHarness';
import {appStore} from '../src/store/appStore';
import {demoStore} from '../src/store/demoStore';

const {act} = ReactTestRenderer;
type Renderer = ReactTestRenderer.ReactTestRenderer;

const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      jest.advanceTimersByTime(80);
    });
  }
};

const mounted: Renderer[] = [];

// The whole rendered tree as text. Screens kept alive underneath the one under test
// (Home, with its pull-to-refresh control) hold React elements in props, which are
// circular; skip that one prop and keep everything else the assertions read.
const treeJson = (r: {toJSON: () => unknown}) =>
  JSON.stringify(r.toJSON(), (key, value) =>
    key === 'refreshControl' ? undefined : value,
  );

async function open(
  route: React.ComponentProps<typeof TestApp>['stack'],
): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(<TestApp stack={route} />);
  });
  mounted.push(r);
  await settle();
  return r;
}

function focusedHost(r: Renderer) {
  return r.root.findAll(
    n =>
      typeof n.props.testID === 'string' &&
      n.props.testID.startsWith('screen-') &&
      n.props.pointerEvents === 'auto',
  )[0];
}

/** Press the first pressable whose label matches (string prefix or regexp). */
async function press(r: Renderer, label: string | RegExp) {
  const root = focusedHost(r) ?? r.root;
  const node = root
    .findAll(
      n =>
        typeof n.props.onPress === 'function' &&
        typeof n.props.accessibilityLabel === 'string',
    )
    .find(n =>
      typeof label === 'string'
        ? n.props.accessibilityLabel === label ||
          n.props.accessibilityLabel.startsWith(label)
        : label.test(n.props.accessibilityLabel),
    );
  if (!node) {
    throw new Error(`No pressable "${label}" on ${probe.current}`);
  }
  await act(async () => {
    node.props.onPress();
  });
  await settle();
}

/** Sheets render in a Modal outside the focused host. */
async function pressAnywhere(r: Renderer, label: string) {
  const node = r.root
    .findAll(
      n =>
        typeof n.props.onPress === 'function' &&
        n.props.accessibilityLabel === label,
    )
    .pop();
  if (!node) {
    throw new Error(`No pressable "${label}"`);
  }
  await act(async () => {
    node.props.onPress();
  });
  await settle();
}

beforeAll(() => {
  jest.useFakeTimers();
});

beforeEach(() => {
  seedSignedIn();
});

afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach(r => r.unmount());
  });
});

afterAll(() => {
  jest.useRealTimers();
});

test('scan -> start -> charge -> stop -> failed payment -> retry -> receipt', async () => {
  const r = await open([
    {name: 'ScanQr', params: {stationId: 'st-chargezone-manesar'}},
  ]);

  await act(async () => {
    r.root.findByProps({testID: 'qr-camera'}).props.onDecoded('CHARGEZONE-MANESAR-C2');
  });
  await settle();
  expect(probe.current).toBe('StartCharging');

  await press(r, 'Authorise & start');
  expect(probe.current).toBe('ActiveSession');
  expect(appStore.get().session?.status).toBe('active');
  expect(appStore.get().session?.preauthId).toBeTruthy();

  await press(r, 'Stop charging');
  await pressAnywhere(r, 'Stop & pay');
  expect(probe.current).toBe('Payment');
  expect(appStore.get().session?.status).toBe('payment_due');

  demoStore.set({paymentFail: 'next'});
  await press(r, /^Pay /);
  expect(probe.current).toBe('PaymentFailure');
  expect(appStore.get().session?.status).toBe('payment_failed');
  expect(appStore.get().session).not.toBeNull(); // nothing is lost

  await press(r, /^Retry /);
  expect(probe.current).toBe('Receipt');
  expect(appStore.get().session).toBeNull();
  expect(appStore.get().history[0].status).toBe('paid');
});

test('an external station never starts: operator instructions are shown instead', async () => {
  const r = await open([
    {
      name: 'StartCharging',
      params: {stationId: 'st-jiobp-lodhi', connectorId: 'st-jiobp-lodhi-c1'},
    },
  ]);
  const text = treeJson(r);
  expect(text).toContain('runs this charger');
  expect(text).toContain('PlugOrbit can’t start or bill this charger');
  expect(text).not.toContain('Authorise & start');
  expect(appStore.get().session).toBeNull();
});

test('without a verified payment method the charger cannot be started', async () => {
  appStore.set(s => ({
    paymentMethods: s.paymentMethods.map(m => ({...m, validated: false})),
  }));
  const r = await open([
    {
      name: 'StartCharging',
      params: {
        stationId: 'st-chargezone-manesar',
        connectorId: 'st-chargezone-manesar-c1',
      },
    },
  ]);
  const cta = focusedHost(r)
    .findAll(
      n =>
        n.props.accessibilityLabel === 'Authorise & start' &&
        typeof n.props.accessibilityState === 'object',
    )
    .pop();
  expect(cta?.props.accessibilityState.disabled).toBe(true);
  expect(treeJson(r)).toContain('Add a verified payment method');
  expect(appStore.get().session).toBeNull();
});

test('an occupied connector offers a free one instead of starting', async () => {
  const r = await open([
    {
      name: 'StartCharging',
      params: {
        stationId: 'st-chargezone-neemrana',
        connectorId: 'st-chargezone-neemrana-c1',
      },
    },
  ]);
  expect(treeJson(r)).toContain('occupied');
  await press(r, /^Use C/);
  expect(treeJson(r)).toContain('AVAILABLE');
});

test('presenter integration outage hands over to the operator flow', async () => {
  demoStore.set({integrationDown: true});
  const r = await open([
    {
      name: 'StartCharging',
      params: {
        stationId: 'st-chargezone-manesar',
        connectorId: 'st-chargezone-manesar-c1',
      },
    },
  ]);
  expect(treeJson(r)).toContain('temporarily unavailable');
});

describe('restart recovery', () => {
  test('active session reopens on the live screen', () => {
    seedSignedIn({session: 'active'});
    const plan = planBoot(appStore.get());
    expect(plan.stack).toEqual([{name: 'ActiveSession'}]);
  });

  test('a stopped session reopens on payment, a failed one on recovery', () => {
    seedSignedIn({session: 'payment_due'});
    expect(planBoot(appStore.get()).stack[0]).toEqual({
      name: 'Payment',
      params: {sessionId: 'PO-LIVE01'},
    });
    seedSignedIn({session: 'payment_failed'});
    expect(planBoot(appStore.get()).stack[0]).toEqual({
      name: 'PaymentFailure',
      params: {sessionId: 'PO-LIVE01'},
    });
  });

  test('a half-finished authorisation is cancelled, not resumed', () => {
    seedSignedIn();
    appStore.set({session: {...liveSession('active'), status: 'authorising'}});
    const plan = planBoot(appStore.get());
    expect(plan.cancelPendingSession).toBe(true);
    expect(plan.stack).toEqual([]);
  });

  test('no vehicle sends a new account to onboarding first', () => {
    seedSignedIn();
    appStore.set({vehicles: [], activeVehicleId: null});
    expect(planBoot(appStore.get()).stack[0]).toEqual({
      name: 'VehicleSetup',
      params: {onboarding: true},
    });
  });
});
