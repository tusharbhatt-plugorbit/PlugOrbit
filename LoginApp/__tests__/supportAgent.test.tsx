/**
 * @format
 *
 * The support agent inbox is for authorised agents only: the entry is on the Support
 * screen when the Backend says so (/support/access), and nowhere else.
 */

jest.mock('../src/services/support', () => ({
  ...jest.requireActual('../src/services/support'),
  supportAgentAccess: jest.fn(),
}));

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Text} from 'react-native';
import {TestApp, probe, seedSignedIn} from '../src/dev/testHarness';
import {supportAgentAccess} from '../src/services/support';

const {act} = ReactTestRenderer;
type Renderer = ReactTestRenderer.ReactTestRenderer;
const access = supportAgentAccess as jest.Mock;
const mounted: Renderer[] = [];

const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      jest.advanceTimersByTime(60);
    });
  }
};

async function openSupport(): Promise<Renderer> {
  let renderer!: Renderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <TestApp tab="Profile" stack={[{name: 'Support'}]} />,
    );
  });
  mounted.push(renderer);
  await flush();
  return renderer;
}

const texts = (r: Renderer) =>
  r.root
    .findAllByType(Text)
    .map(n => ([] as unknown[]).concat(n.props.children).join(''));

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

test('a support agent sees the inbox entry, and it opens the inbox', async () => {
  access.mockResolvedValue(true);
  const r = await openSupport();
  expect(texts(r)).toContain('Support agent inbox');

  let node: ReactTestRenderer.ReactTestInstance | null =
    r.root.findAllByType(Text).find(n => n.props.children === 'Support agent inbox') ??
    null;
  while (node && !node.props.onPress) {
    node = node.parent;
  }
  await act(async () => {
    node!.props.onPress();
  });
  await flush();
  expect(probe.current).toBe('SupportAgent');
});

test('an ordinary driver never sees the inbox entry', async () => {
  access.mockResolvedValue(false);
  const r = await openSupport();
  expect(texts(r)).not.toContain('Support agent inbox');
});

test('if the access check fails the entry stays hidden and the screen still works', async () => {
  access.mockRejectedValue(new Error('offline'));
  const r = await openSupport();
  expect(texts(r)).not.toContain('Support agent inbox');
  expect(texts(r)).toContain('Support');
});
