/**
 * @format
 *
 * Opens every screen and presses every button on it. A screen passes if
 *  - it renders without throwing or logging a React error,
 *  - every pressable can be pressed without throwing,
 *  - every press leaves the app on a registered route,
 *  - every pressable is usable by a screen reader (label or text).
 * It also checks that every route is reachable from some other screen.
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Text} from 'react-native';
import {ROUTE_FIXTURES} from '../src/dev/fixtures';
import {TestApp, probe, seedSignedIn} from '../src/dev/testHarness';
import {REGISTRY} from '../src/navigation/registry';
import {RouteName, TABS, TabName, isTab} from '../src/navigation/params';

const ROUTES = Object.keys(REGISTRY) as RouteName[];
const {act} = ReactTestRenderer;

// Opening a screen needs the right app state for these.
const SESSION_FOR: Partial<
  Record<RouteName, 'active' | 'payment_due' | 'payment_failed'>
> = {
  ActiveSession: 'active',
  Payment: 'payment_due',
  PaymentFailure: 'payment_failed',
};

const settle = async () => {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      jest.advanceTimersByTime(60);
    });
  }
};

async function open(
  route: RouteName,
): Promise<ReactTestRenderer.ReactTestRenderer> {
  seedSignedIn({session: SESSION_FOR[route]});
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      isTab(route) ? (
        <TestApp tab={route as TabName} />
      ) : (
        <TestApp stack={[{name: route, params: ROUTE_FIXTURES[route]}]} />
      ),
    );
  });
  await settle();
  return renderer;
}

function pressables(renderer: ReactTestRenderer.ReactTestRenderer) {
  const seen = new Set<unknown>();
  const out: ReactTestRenderer.ReactTestInstance[] = [];
  // Only the focused screen: kept-alive screens underneath are hidden.
  const host = renderer.root.findAll(
    n =>
      typeof n.props.testID === 'string' &&
      n.props.testID.startsWith('screen-') &&
      n.props.pointerEvents === 'auto',
  )[0];
  if (!host) {
    return out;
  }
  host
    .findAll(
      n =>
        typeof n.props.onPress === 'function' &&
        n.props.testID !== 'map' &&
        n.props.initialRegion === undefined,
    )
    .forEach(n => {
      if (!seen.has(n.props.onPress)) {
        seen.add(n.props.onPress);
        out.push(n);
      }
    });
  return out;
}

function hasText(node: ReactTestRenderer.ReactTestInstance): boolean {
  try {
    return node.findAllByType(Text).length > 0;
  } catch {
    return false;
  }
}

let errors: string[] = [];
let errorSpy: jest.SpyInstance;
const reached = new Map<RouteName, Set<RouteName>>();

beforeAll(() => {
  jest.useFakeTimers();
});

beforeEach(() => {
  errors = [];
  errorSpy = jest.spyOn(console, 'error').mockImplementation((...args) => {
    errors.push(args.map(String).join(' ').slice(0, 400));
  });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  jest.restoreAllMocks();
});

afterAll(() => {
  jest.useRealTimers();
});

describe.each(ROUTES)('%s', route => {
  test('renders without errors', async () => {
    const renderer = await open(route);
    expect(renderer.toJSON()).not.toBeNull();
    expect(errors).toEqual([]);
    await act(async () => renderer.unmount());
  });

  test('every button is accessible and leads somewhere valid', async () => {
    const first = await open(route);
    const count = pressables(first).length;
    await act(async () => first.unmount());

    const targets = new Set<RouteName>();
    const problems: string[] = [];
    for (let i = 0; i < count; i++) {
      const renderer = await open(route);
      try {
        const node = pressables(renderer)[i];
        if (!node) {
          continue;
        }
        const label = node.props.accessibilityLabel;
        if (typeof label !== 'string' && !hasText(node)) {
          problems.push(`button #${i} has no accessibility label or text`);
        }
        await act(async () => {
          node.props.onPress();
        });
        await settle();
        if (!probe.current || !REGISTRY[probe.current]) {
          problems.push(
            `button #${i} (${
              label ?? 'text'
            }) left the app on an unknown route`,
          );
        } else if (probe.current !== route) {
          targets.add(probe.current);
        }
      } catch (e) {
        problems.push(`button #${i} threw: ${(e as Error).message}`);
      } finally {
        await act(async () => renderer.unmount());
      }
    }
    reached.set(route, targets);
    expect(problems).toEqual([]);
    expect(errors).toEqual([]);
  });
});

// Routes only reachable through the tab bar (not a button on a screen).
const TAB_ONLY = new Set<RouteName>(TABS);

test('every route is reachable from a button on another screen', () => {
  const reachable = new Set<RouteName>(TAB_ONLY);
  reached.forEach(targets => targets.forEach(t => reachable.add(t)));
  const unreachable = ROUTES.filter(r => !reachable.has(r));
  expect(unreachable).toEqual([]);
});
