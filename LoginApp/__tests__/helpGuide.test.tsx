/**
 * @format
 *
 * The Orbit help guide: written answers about the app that work offline, plus optional
 * online answers from the Backend's /assistant/guide endpoints. (Orbit Assist, the
 * tool-using co-driver, is covered in __tests__/assistant.)
 */

jest.mock('../src/services/orbitAssistant', () => ({
  orbitConfigured: jest.fn(),
  askOrbit: jest.fn(),
}));

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Text, TextInput} from 'react-native';
import {TestApp, probe, seedSignedIn} from '../src/dev/testHarness';
import {offlineReply} from '../src/screens/activity/AIAssistantScreen';
import {askOrbit, orbitConfigured} from '../src/services/orbitAssistant';

const {act} = ReactTestRenderer;
type Renderer = ReactTestRenderer.ReactTestRenderer;
const configured = orbitConfigured as jest.Mock;
const ask = askOrbit as jest.Mock;
const mounted: Renderer[] = [];

const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      jest.advanceTimersByTime(60);
    });
  }
};

async function openGuide(): Promise<Renderer> {
  let renderer!: Renderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <TestApp tab="Profile" stack={[{name: 'AIAssistant'}]} />,
    );
  });
  mounted.push(renderer);
  await flush();
  return renderer;
}

const texts = (r: Renderer) =>
  r.root.findAllByType(Text).map(n => ([] as unknown[]).concat(n.props.children).join(''));

const pressLabel = async (r: Renderer, label: string) => {
  const node = r.root.findAll(
    n => typeof n.props.onPress === 'function' && n.props.accessibilityLabel === label,
  )[0];
  await act(async () => {
    node.props.onPress();
  });
  await flush();
};

const pressText = async (r: Renderer, label: string) => {
  let node: ReactTestRenderer.ReactTestInstance | null =
    r.root.findAllByType(Text).find(n => n.props.children === label) ?? null;
  while (node && !node.props.onPress) {
    node = node.parent;
  }
  await act(async () => {
    node!.props.onPress();
  });
  await flush();
};

beforeAll(() => {
  jest.useFakeTimers();
});
beforeEach(() => {
  seedSignedIn();
  configured.mockReset();
  ask.mockReset();
});
afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach(r => r.unmount());
  });
});
afterAll(() => {
  jest.useRealTimers();
});

describe('offlineReply', () => {
  test.each([
    ['How do I sign in with Google?', /Google opens a browser/],
    ['where is my receipt', /Download receipt/],
    ['how does the qr scanner work', /Scan charger QR/],
    ['any cafes near the station', /Nearby amenities/],
    ['I need a support ticket', /Support center/],
    ['dark mode?', /Appearance/],
    ['how do I back up my data', /Sync now/],
    ['plan a trip to Jaipur', /Route Planner/],
    ['what is soc', /State of Charge/],
    ['can I book a slot', /Reservation/],
    ['can I talk to the assistant in Hindi', /Orbit Assist is the co-driver/],
  ])('%s', (question, expected) => {
    expect(offlineReply(question)).toMatch(expected);
  });

  test('anything else points to what the guide covers and to Orbit Assist', () => {
    expect(offlineReply('what is the meaning of life')).toMatch(/Orbit Assist/);
  });
});

describe('the screen', () => {
  test('works offline: says so, and answers a quick question from the written guide', async () => {
    configured.mockResolvedValue(false);
    const r = await openGuide();
    expect(texts(r)).toContain('Offline help guide: works without a connection');
    await pressLabel(r, 'What is SOC?');
    expect(texts(r).join('|')).toContain('State of Charge');
    expect(ask).not.toHaveBeenCalled();
  });

  test('uses online answers when the Backend has them configured', async () => {
    configured.mockResolvedValue(true);
    ask.mockResolvedValue('Open Trips and plan it.');
    const r = await openGuide();
    expect(texts(r)).toContain('Online answers about PlugOrbit');
    await act(async () => {
      r.root.findByType(TextInput).props.onChangeText('How do I plan a trip?');
    });
    await pressLabel(r, 'Send message');
    expect(ask).toHaveBeenCalledWith('How do I plan a trip?', []);
    expect(texts(r)).toContain('Open Trips and plan it.');
  });

  test('an online failure keeps the question, explains it, and can fall back to offline help', async () => {
    configured.mockResolvedValue(true);
    ask.mockRejectedValue(new Error('Online Orbit is busy. Try again shortly.'));
    const r = await openGuide();
    await act(async () => {
      r.root.findByType(TextInput).props.onChangeText('What is SOC?');
    });
    await pressLabel(r, 'Send message');
    expect(texts(r)).toContain('Online Orbit is busy. Try again shortly.');
    expect(r.root.findByType(TextInput).props.value).toBe('What is SOC?');
    await pressLabel(r, 'Use offline help');
    expect(texts(r)).toContain('Offline help guide: works without a connection');
    expect(texts(r)).not.toContain('Online Orbit is busy. Try again shortly.');
  });

  test('an empty message is not sent', async () => {
    configured.mockResolvedValue(true);
    const r = await openGuide();
    await act(async () => {
      r.root.findByType(TextInput).props.onChangeText('   ');
    });
    await pressLabel(r, 'Send message');
    expect(ask).not.toHaveBeenCalled();
  });

  test('links to Orbit Assist and to the trip planner', async () => {
    configured.mockResolvedValue(false);
    const r = await openGuide();
    await pressText(r, 'Talk to Orbit Assist →');
    expect(probe.current).toBe('Assistant');
  });
});
