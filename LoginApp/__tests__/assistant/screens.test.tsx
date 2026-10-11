/**
 * @format
 * The Orbit Assist screens, sheet and entry points, driven through the real navigator
 * with a controller built on fakes (no network, no microphone).
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Modal, Switch, Text, TextInput} from 'react-native';
import {GatewayError} from '../../src/assistant/gateway';
import {resetAssistantRuntime} from '../../src/assistant/runtime';
import {assistantStore, updateSettings} from '../../src/assistant/store';
import {DEFAULT_SETTINGS} from '../../src/assistant/types';
import {appStore} from '../../src/store/appStore';
import {
  done,
  makeRig,
  session,
  text,
  type Rig,
} from '../../src/dev/assistantFakes';
import {ROUTE_FIXTURES} from '../../src/dev/fixtures';
import {TestApp, probe, seedSignedIn} from '../../src/dev/testHarness';
import type {RouteName, TabName} from '../../src/navigation/params';
import {createMemoryStorage, setStorage} from '../../src/store/storage';

const {act} = ReactTestRenderer;
type Renderer = ReactTestRenderer.ReactTestRenderer;

const flush = async () => {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      jest.advanceTimersByTime(60);
    });
  }
};

const mounted: Renderer[] = [];
let rig: Rig;

async function open(
  route: RouteName | TabName,
  tab = false,
): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      tab ? (
        <TestApp tab={route as TabName} />
      ) : (
        <TestApp
          stack={[
            {
              name: route as RouteName,
              params: ROUTE_FIXTURES[route as RouteName],
            },
          ]}
        />
      ),
    );
  });
  mounted.push(r);
  await flush();
  return r;
}

const allText = (r: Renderer) =>
  r.root
    .findAllByType(Text)
    .map(n => ([] as unknown[]).concat(n.props.children).join(''))
    .join(' | ');

const labelOf = (n: ReactTestRenderer.ReactTestInstance): string =>
  typeof n.props.accessibilityLabel === 'string'
    ? n.props.accessibilityLabel
    : n
        .findAllByType(Text)
        .map(t => ([] as unknown[]).concat(t.props.children).join(''))
        .join(' ');

const pressable = (r: Renderer, label: string | RegExp) =>
  r.root.findAll(
    n =>
      typeof n.props.onPress === 'function' &&
      (typeof label === 'string'
        ? labelOf(n) === label
        : label.test(labelOf(n))),
  )[0];

const press = async (r: Renderer, label: string | RegExp) => {
  const node = pressable(r, label);
  if (!node) {
    throw new Error(
      `No button labelled ${label}. Found: ${allText(r).slice(0, 500)}`,
    );
  }
  await act(async () => {
    node.props.onPress();
  });
  await flush();
};

/** The focused screen, without the overlay (floating button, sheet) mounted beside it. */
const screenOf = (r: Renderer) =>
  r.root.findAll(
    n =>
      typeof n.props.testID === 'string' &&
      n.props.testID.startsWith('screen-') &&
      n.props.pointerEvents === 'auto',
  )[0];

/** The assistant sheet, only while it is open (a closed Modal renders nothing on a phone). */
const openSheet = (r: Renderer) =>
  r.root.findAll(n => n.type === Modal && n.props.visible === true)[0];

const typeAndSend = async (r: Renderer, message: string) => {
  const input = r.root.find(
    n =>
      n.props.accessibilityLabel === 'Type a message to Orbit' &&
      n.type === TextInput,
  );
  await act(async () => {
    input.props.onChangeText(message);
  });
  await press(r, 'Send message');
};

beforeAll(() => jest.useFakeTimers());
afterAll(() => jest.useRealTimers());

beforeEach(() => {
  setStorage(createMemoryStorage());
  seedSignedIn({soc: 60});
  rig = makeRig();
  resetAssistantRuntime(rig.controller);
});

afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach(r => r.unmount());
  });
  resetAssistantRuntime();
});

describe('signing out', () => {
  test('leaves nothing of the conversation, memory or consent for the next person', async () => {
    rig.gateway.scripts = [[session('s5'), text('Hi.'), done()]];
    updateSettings({rememberPreferences: true, voiceLanguage: 'hi'});
    assistantStore.set({
      journey: {destination: 'Jaipur', updated_at: Date.now()},
      preferences: [{key: 'prioritise', value: 'cost', savedAt: 1}],
    });
    await open('Home', true);
    await act(async () => {
      await rig.controller.send('hello');
    });
    expect(assistantStore.get().messages.length).toBeGreaterThan(0);
    await act(async () => {
      appStore.set({signedIn: false}); // what Sign out does
      mounted.splice(0).forEach(m => m.unmount()); // the signed-in app goes away
    });
    await flush();
    const s = assistantStore.get();
    expect(s.messages).toEqual([]);
    expect(s.journey).toBeNull();
    expect(s.preferences).toEqual([]);
    expect(s.settings).toEqual(DEFAULT_SETTINGS);
    expect(rig.gateway.cleared).toContain('s5');
  });
});

describe('consent', () => {
  test('nothing can be sent until the driver turns the AI on', async () => {
    assistantStore.set(s => ({settings: {...s.settings, aiConsentAt: null}}));
    const r = await open('Assistant');
    expect(allText(r)).toContain('Turn on Orbit’s AI');
    expect(allText(r)).toMatch(/never records or keeps your voice/);
    expect(allText(r)).toMatch(/Google or Apple/);
    const input = r.root.find(
      n =>
        n.props.accessibilityLabel === 'Type a message to Orbit' &&
        n.type === TextInput,
    );
    expect(input.props.editable).toBe(false);
    expect(
      r.root.find(
        n => n.props.accessibilityLabel === 'Microphone not available',
      ).props.onPress,
    ).toBeUndefined();
    await press(r, 'Turn on');
    expect(assistantStore.get().settings.aiConsentAt).not.toBeNull();
    expect(allText(r)).toContain('Where are we going?');
  });
});

describe('the conversation', () => {
  test('sends what is typed and shows the reply, with an approval card that does nothing until tapped', async () => {
    rig.gateway.scripts = [
      [
        session(),
        text('I can plan that. '),
        text('Want me to set it up?'),
        {
          type: 'actions',
          actions: [
            {
              id: 'a1',
              kind: 'start_journey',
              label: 'Start trip to Jaipur',
              detail: 'Plans the charging for your trip.',
              params: {destination: 'Jaipur'},
              status: 'pending_approval',
            },
          ],
        },
        done({
          sources: [
            {
              tool: 'recommend_charging_stops',
              kind: 'deterministic_engine',
              demo: true,
              status: 'ok',
            },
          ],
        }),
      ],
    ];
    const r = await open('Assistant');
    await typeAndSend(r, 'Take me to Jaipur');
    expect(rig.gateway.bodies[0]).toMatchObject({message: 'Take me to Jaipur'});
    const t = allText(r);
    expect(t).toContain('Take me to Jaipur');
    expect(t).toContain('I can plan that. Want me to set it up?');
    expect(t).toContain('Start trip to Jaipur');
    expect(t).toContain('Needs your OK');
    expect(t).toContain('Based on the trip planner. Preview data.');
    expect(rig.performed).toEqual([]); // shown, not done

    await press(r, 'Yes, do it');
    expect(rig.performed).toEqual(['a1']);
    expect(allText(r)).toContain('Done');
    expect(allText(r)).toContain('did start_journey');
    expect(pressable(r, 'Yes, do it')).toBeUndefined(); // can't be pressed twice
  });

  test('a failed action is shown as failed', async () => {
    rig = makeRig({
      performAction: async () => ({
        status: 'failed',
        message: 'No compatible charger was found.',
      }),
    });
    resetAssistantRuntime(rig.controller);
    rig.gateway.scripts = [
      [
        session(),
        text('Okay.'),
        {
          type: 'actions',
          actions: [
            {
              id: 'a1',
              kind: 'switch_charger',
              label: 'Switch charger',
              params: {station_id: 'x'},
              status: 'pending_approval',
            },
          ],
        },
        done(),
      ],
    ];
    const r = await open('Assistant');
    await typeAndSend(r, 'switch');
    await press(r, 'Yes, do it');
    expect(allText(r)).toContain('Didn’t work');
    expect(allText(r)).toContain('No compatible charger was found.');
  });

  test('suggestion chips send real questions', async () => {
    rig.gateway.scripts = [[session(), text('Checking.'), done()]];
    const r = await open('Assistant');
    await press(r, 'Which charging station is cheapest?');
    expect(rig.gateway.bodies[0]).toMatchObject({
      message: 'Which charging station is cheapest?',
    });
  });

  test('shows what Orbit knows about the car and the trip', async () => {
    assistantStore.set({
      journey: {
        destination: 'Jaipur',
        min_arrival_soc_pct: 20,
        updated_at: Date.now(),
      },
    });
    const r = await open('Assistant');
    const t = allText(r);
    expect(t).toContain('Nexon');
    expect(t).toContain('60%');
    expect(t).toContain('To Jaipur');
    expect(t).toContain('Keep 20%');
    expect(t).toContain('Preview data');
  });

  test('explains an outage honestly and offers the manual planner', async () => {
    rig.gateway.scripts = [new GatewayError('OFFLINE', 'x')];
    const r = await open('Assistant');
    await typeAndSend(r, 'hello');
    expect(allText(r)).toMatch(/can’t reach the assistant/);
    await press(r, 'Plan a route');
    expect(probe.current).toBe('RoutePlanner');
  });

  test('end conversation forgets the server copy and leaves the screen', async () => {
    rig.gateway.scripts = [[session('s9'), text('Hi.'), done()]];
    const r = await open('Assistant');
    await typeAndSend(r, 'hello');
    await press(r, 'End conversation');
    expect(rig.gateway.cleared).toEqual(['s9']);
    expect(probe.current).toBe('Home');
  });
});

describe('the microphone', () => {
  test('tap to talk shows what is being heard, and tap again sends it', async () => {
    rig.gateway.scripts = [[session(), text('Sure.'), done()]];
    const r = await open('Assistant');
    await press(r, 'Tap to talk to Orbit');
    expect(rig.recognizer.started).toBe(1);
    expect(allText(r)).toContain('Listening…');
    await act(async () => {
      rig.recognizer.events!.onPartial('Jaipur jaana hai');
    });
    expect(allText(r)).toContain('Jaipur jaana hai');
    rig.recognizer.finalOnStop = 'Jaipur jaana hai';
    await press(r, 'Stop listening and send');
    expect(rig.gateway.bodies[0]).toMatchObject({message: 'Jaipur jaana hai'});
    expect(rig.gateway.bodies[0].context).toMatchObject({input_mode: 'voice'});
  });

  test('a refused microphone is explained, with a way to fix it', async () => {
    rig.permissions.state = 'blocked';
    const r = await open('Assistant');
    await press(r, 'Tap to talk to Orbit');
    expect(rig.recognizer.started).toBe(0);
    expect(allText(r)).toMatch(/Microphone is off for PlugOrbit/);
    expect(pressable(r, 'Open phone settings')).toBeDefined();
  });

  test('without speech support the screen says to type', async () => {
    rig.recognizer.available = false;
    const r = await open('Assistant');
    expect(allText(r)).toMatch(/Voice isn’t available on this phone/);
    expect(
      r.root.find(
        n => n.props.accessibilityLabel === 'Microphone not available',
      ).props.onPress,
    ).toBeUndefined();
  });

  test('"Talk to Orbit" on Home opens the assistant already listening', async () => {
    const r = await open('Home', true);
    await press(r, 'Talk to Orbit');
    expect(probe.current).toBe('Assistant');
    expect(rig.recognizer.started).toBe(1);
  });

  test('"Talk to Orbit" on Trips does the same', async () => {
    const r = await open('Trips', true);
    await press(r, 'Talk to Orbit');
    expect(probe.current).toBe('Assistant');
    expect(rig.recognizer.started).toBe(1);
  });
});

describe('voice controls', () => {
  test('mute, stop and hear again', async () => {
    rig.synthesizer.manual = true;
    rig.gateway.scripts = [
      [session(), text('First sentence here. Second one follows.'), done()],
    ];
    const r = await open('Assistant');
    await press(r, 'Tap to talk to Orbit');
    await act(async () => {
      rig.recognizer.events!.onFinal('hello');
    });
    await flush();
    expect(assistantStore.get().phase).toBe('speaking');
    await press(r, 'Stop talking');
    expect(assistantStore.get().phase).toBe('idle');
    await press(r, 'Mute Orbit');
    expect(assistantStore.get().settings.muted).toBe(true);
    const before = rig.synthesizer.spoken.length;
    await press(r, 'Hear the last answer again');
    expect(rig.synthesizer.spoken.length).toBeGreaterThan(before);
  });
});

describe('settings', () => {
  test('language, text only and forgetting are all reachable and take effect', async () => {
    const r = await open('Assistant');
    await press(r, 'Assistant settings');
    expect(allText(r)).toContain('Remember my preferences');
    expect(allText(r)).toContain('Driving mode');
    await act(async () => {
      r.root
        .find(
          n => n.type === Switch && n.props.accessibilityLabel === 'Text only',
        )
        .props.onValueChange(true);
    });
    expect(assistantStore.get().settings.textOnly).toBe(true);
    await act(async () => {
      r.root
        .find(
          n =>
            n.type === Switch &&
            n.props.accessibilityLabel === 'Remember my preferences',
        )
        .props.onValueChange(true);
    });
    expect(assistantStore.get().settings.rememberPreferences).toBe(true);
    await press(r, 'हिन्दी');
    expect(assistantStore.get().settings.voiceLanguage).toBe('hi');
    await press(r, 'Detailed');
    expect(assistantStore.get().settings.responseStyle).toBe('detailed');
  });

  test('saved preferences can be seen, forgotten, and erased', async () => {
    updateSettings({rememberPreferences: true});
    assistantStore.set({
      preferences: [{key: 'prioritise', value: 'cost', savedAt: Date.now()}],
      journey: {destination: 'Jaipur', updated_at: Date.now()},
    });
    const r = await open('Assistant');
    await press(r, 'Assistant settings');
    expect(allText(r)).toContain('Priority: cost');
    await press(r, 'Forget');
    expect(assistantStore.get().preferences).toEqual([]);
    assistantStore.set({
      preferences: [{key: 'strategy', value: 'cheapest', savedAt: 1}],
    });
    await press(r, 'Erase everything Orbit keeps');
    expect(assistantStore.get().preferences).toEqual([]);
    expect(assistantStore.get().journey).toBeNull();
  });
});

describe('driving mode', () => {
  test('shows a large microphone and no typing', async () => {
    updateSettings({drivingMode: true});
    rig.gateway.scripts = [
      [session(), text('You have enough battery.'), done()],
    ];
    const r = await open('Assistant');
    expect(
      r.root.findAll(n => n.props.testID === 'driving-mode').length,
    ).toBeGreaterThan(0);
    expect(screenOf(r).findAllByType(TextInput)).toHaveLength(0);
    expect(pressable(r, 'Tap to talk to Orbit')).toBeDefined();
    expect(allText(r)).toContain('Tap the mic and ask Orbit.');
    await press(r, 'Tap to talk to Orbit');
    expect(allText(r)).toContain('Listening…');
    await press(r, 'Leave driving mode');
    expect(assistantStore.get().settings.drivingMode).toBe(false);
  });
});

describe('the floating assistant and its sheet', () => {
  test.each([
    ['Home', true],
    ['Trips', true],
    ['Map', false],
    ['SmartDrive', false],
    ['RoutePlanner', false],
    ['Navigation', false],
  ] as const)('is on %s', async (route, tab) => {
    const r = await open(route, tab);
    expect(pressable(r, 'Open Orbit Assist')).toBeDefined();
  });

  test.each([
    ['Profile', true],
    ['Activity', true],
    ['Assistant', false],
    ['Compare', false],
  ] as const)('is not on %s', async (route, tab) => {
    const r = await open(route, tab);
    expect(pressable(r, 'Open Orbit Assist')).toBeUndefined();
  });

  test('opens a sheet over the current screen without leaving it', async () => {
    const r = await open('Map');
    await press(r, 'Open Orbit Assist');
    expect(assistantStore.get().sheetOpen).toBe(true);
    expect(probe.current).toBe('Map');
    expect(allText(r)).toMatch(/Ask Orbit about your battery/);
    expect(openSheet(r).findAllByType(TextInput)).toHaveLength(1);
  });

  test('the floating button steps aside while the sheet is open', async () => {
    const r = await open('Home', true);
    await press(r, 'Open Orbit Assist');
    expect(assistantStore.get().sheetOpen).toBe(true);
    expect(pressable(r, 'Open Orbit Assist')).toBeUndefined();
  });

  test('on the Map the entry is a button in the map’s own control stack, not a floating one', async () => {
    const r = await open('Map');
    const button = r.root.find(n => n.props.testID === 'map-assistant');
    expect(button).toBeDefined();
    expect(
      r.root.findAll(n => n.props.testID === 'floating-assistant'),
    ).toHaveLength(0);
  });

  test('answers inside the sheet, and the full conversation is one tap away', async () => {
    rig.gateway.scripts = [
      [session(), text('Your battery is at 60 percent.'), done()],
    ];
    const r = await open('Home', true);
    await press(r, 'Open Orbit Assist');
    await typeAndSend(r, 'battery?');
    expect(allText(r)).toContain('Your battery is at 60 percent.');
    await press(r, 'Open full conversation');
    expect(probe.current).toBe('Assistant');
    expect(assistantStore.get().sheetOpen).toBe(false);
    expect(allText(r)).toContain('Your battery is at 60 percent.'); // same conversation
  });

  test('closing the sheet silences Orbit', async () => {
    rig.synthesizer.manual = true;
    rig.gateway.scripts = [
      [session(), text('A long answer. And more to say.'), done()],
    ];
    const r = await open('Home', true);
    await press(r, 'Open Orbit Assist');
    await press(r, 'Tap to talk to Orbit');
    await act(async () => {
      rig.recognizer.events!.onFinal('tell me');
    });
    await flush();
    expect(assistantStore.get().phase).toBe('speaking');
    await press(r, 'Close');
    expect(assistantStore.get().sheetOpen).toBe(false);
    expect(assistantStore.get().phase).toBe('idle');
    expect(rig.synthesizer.stops).toBeGreaterThan(0);
  });

  test('driving mode in the sheet is a big microphone only', async () => {
    updateSettings({drivingMode: true});
    const r = await open('Map');
    await press(r, 'Open Orbit Assist');
    expect(openSheet(r).findAllByType(TextInput)).toHaveLength(0);
    expect(pressable(r, 'Tap to talk to Orbit')).toBeDefined();
  });
});
