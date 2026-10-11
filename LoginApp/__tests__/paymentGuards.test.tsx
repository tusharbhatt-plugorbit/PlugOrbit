/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Text} from 'react-native';
import {TestApp, seedSignedIn} from '../src/dev/testHarness';
import {createMockServices} from '../src/services';
import type {Services} from '../src/services/types';

const {act} = ReactTestRenderer;
type Renderer = ReactTestRenderer.ReactTestRenderer;
const mounted: Renderer[] = [];

const flush = async () => {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
  }
};

async function open(
  stack: React.ComponentProps<typeof TestApp>['stack'],
  services: Partial<Services>,
): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(<TestApp stack={stack} services={services} />);
  });
  mounted.push(r);
  await flush();
  return r;
}

/** The button's own handler, as it stood in the render both taps would see. */
const handlerOf = (r: Renderer, label: string | RegExp) => {
  const node = r.root.find(
    n =>
      typeof n.props.onPress === 'function' &&
      typeof n.props.accessibilityLabel === 'string' &&
      (typeof label === 'string'
        ? n.props.accessibilityLabel === label
        : label.test(n.props.accessibilityLabel)),
  );
  return node.props.onPress as () => void;
};

/** Two taps in the same frame: neither has seen the other's state update yet. */
const doubleTap = async (handler: () => void) => {
  await act(async () => {
    handler();
    handler();
  });
};

// A request that never finishes, so the second tap arrives while it is in flight.
const pending = () => jest.fn(() => new Promise(() => undefined));

beforeAll(() => {
  jest.useFakeTimers();
});
afterAll(() => {
  jest.useRealTimers();
});
afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach(r => r.unmount());
  });
});

test('paying twice quickly sends one payment', async () => {
  seedSignedIn({session: 'payment_due'});
  const pay = pending();
  const r = await open([{name: 'Payment', params: {sessionId: 'PO-LIVE01'}}], {
    payment: {...createMockServices().payment, pay} as never,
  });
  await doubleTap(handlerOf(r, /^Pay /));
  expect(pay).toHaveBeenCalledTimes(1);
});

test('retrying a failed payment twice quickly sends one payment', async () => {
  seedSignedIn({session: 'payment_failed'});
  const pay = pending();
  const r = await open(
    [{name: 'PaymentFailure', params: {sessionId: 'PO-LIVE01'}}],
    {payment: {...createMockServices().payment, pay} as never},
  );
  await doubleTap(handlerOf(r, /^Retry /));
  expect(pay).toHaveBeenCalledTimes(1);
});

test('authorising a charger twice quickly starts one session', async () => {
  seedSignedIn();
  const start = pending();
  const r = await open(
    [
      {
        name: 'StartCharging',
        params: {
          stationId: 'st-chargezone-manesar',
          connectorId: 'st-chargezone-manesar-c1',
        },
      },
    ],
    {session: {...createMockServices().session, start} as never},
  );
  await doubleTap(handlerOf(r, 'Authorise & start'));
  expect(start).toHaveBeenCalledTimes(1);
});

describe('developer-only controls', () => {
  const profileTexts = async () => {
    seedSignedIn();
    let r!: Renderer;
    await act(async () => {
      r = ReactTestRenderer.create(<TestApp tab="Profile" />);
    });
    mounted.push(r);
    await flush();
    return r.root
      .findAllByType(Text)
      .map(n => ([] as unknown[]).concat(n.props.children).join(''));
  };

  test('Presenter tools show in a debug build', async () => {
    expect(await profileTexts()).toContain('Presenter tools');
  });

  test('and are not in a release build', async () => {
    const flag = globalThis as unknown as {__DEV__: boolean};
    const before = flag.__DEV__;
    flag.__DEV__ = false;
    try {
      const t = await profileTexts();
      expect(t).not.toContain('Presenter tools');
      // The row above it is still the end of its list: nothing is left dangling.
      expect(t).toContain('Roadside assistance');
    } finally {
      flag.__DEV__ = before;
    }
  });
});
