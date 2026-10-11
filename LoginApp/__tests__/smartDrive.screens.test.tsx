/**
 * @format
 * The Smart Drive screens, and the places it appears in the rest of the app.
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text, TextInput } from 'react-native';
import { noon } from '../src/dev/smartDriveFixtures';
import {
  TestApp,
  probe,
  seedSignedIn,
  seedSmartDriveTrip,
} from '../src/dev/testHarness';
import type { RouteName, TabName } from '../src/navigation/params';
import { assistModeOf } from '../src/intelligence/types';
import { appStore } from '../src/store/appStore';
import { getCurrentLocation } from '../src/services/location';
import { Screen } from '../src/ui/Screen';

jest.mock('../src/services/location', () => ({
  ...jest.requireActual('../src/services/location'),
  getCurrentLocation: jest.fn(),
}));

const { act } = ReactTestRenderer;
type Renderer = ReactTestRenderer.ReactTestRenderer;

const flush = async () => {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      jest.advanceTimersByTime(80);
    });
  }
};

const mounted: Renderer[] = [];

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
        <TestApp stack={[{ name: route as RouteName }]} />
      ),
    );
  });
  mounted.push(r);
  await flush();
  return r;
}

/** The screen the person is looking at (kept-alive screens underneath are hidden). */
const screen = (r: Renderer) =>
  r.root.findAll(
    n =>
      typeof n.props.testID === 'string' &&
      n.props.testID.startsWith('screen-') &&
      n.props.pointerEvents === 'auto',
  )[0];

const texts = (r: Renderer) =>
  screen(r)
    .findAllByType(Text)
    .map(n => ([] as unknown[]).concat(n.props.children).join(''));

const all = (r: Renderer) => texts(r).join(' | ');

const labelOf = (n: ReactTestRenderer.ReactTestInstance): string => {
  if (typeof n.props.accessibilityLabel === 'string') {
    return n.props.accessibilityLabel;
  }
  return n
    .findAllByType(Text)
    .map(t => ([] as unknown[]).concat(t.props.children).join(''))
    .join(' ');
};

const pressable = (r: Renderer, label: string | RegExp) =>
  screen(r).findAll(
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
      `No button labelled ${label}. Found: ${all(r).slice(0, 400)}`,
    );
  }
  await act(async () => {
    node.props.onPress();
  });
  await flush();
};

beforeAll(() => {
  jest.useFakeTimers();
});

beforeEach(() => {
  (getCurrentLocation as jest.Mock)
    .mockReset()
    .mockResolvedValue({ latitude: 28.6139, longitude: 77.209 });
  jest.setSystemTime(noon());
  seedSignedIn({ soc: 72 });
});

afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach(r => r.unmount());
  });
});

afterAll(() => {
  jest.useRealTimers();
});

describe('before a trip: "Where are we going?"', () => {
  test.each([320, 430])(
    'keeps the start action in the scrollable form on a short %i dp display',
    async width => {
      const dimensions = jest
        .spyOn(require('react-native'), 'useWindowDimensions')
        .mockReturnValue({ width, height: 640, scale: 1, fontScale: 1.3 });
      try {
        const r = await open('SmartDrive');
        expect(screen(r).findByType(Screen).props.footer).toBeUndefined();
        expect(pressable(r, 'Start journey')).toBeDefined();
        const content = all(r);
        expect(content.indexOf('From')).toBeLessThan(
          content.indexOf('How should we help?'),
        );
        expect(pressable(r, 'Talk to Orbit')).toBeDefined();
      } finally {
        dimensions.mockRestore();
      }
    },
  );
  test('defaults to device GPS and passes the actual coordinates into the journey', async () => {
    const r = await open('SmartDrive');
    const from = screen(r)
      .findAllByType(TextInput)
      .find(n => n.props.accessibilityLabel === 'From')!;
    expect(from.props.value).toBe('Current location');
    const to = screen(r)
      .findAllByType(TextInput)
      .find(n => n.props.accessibilityLabel === 'To')!;
    await act(async () => to.props.onChangeText('Jaipur'));
    await press(r, 'Start journey');
    expect(appStore.get().smartDrive.trip?.origin.coords).toEqual({
      latitude: 28.6139,
      longitude: 77.209,
    });
    expect(appStore.get().smartDrive.trip?.origin.label).toBe(
      'Current location',
    );
  });

  test('keeps manual origin entry available when permission is denied', async () => {
    (getCurrentLocation as jest.Mock).mockRejectedValue(
      new Error('Location permission was denied.'),
    );
    const r = await open('SmartDrive');
    expect(all(r)).toContain('Location permission was denied.');
    const from = screen(r)
      .findAllByType(TextInput)
      .find(n => n.props.accessibilityLabel === 'From')!;
    expect(from.props.value).toBe('');
    await act(async () => from.props.onChangeText('Delhi'));
    expect(all(r)).not.toContain('Location permission was denied.');
  });

  test('a late GPS fix cannot replace a manually edited origin', async () => {
    let resolve!: (value: { latitude: number; longitude: number }) => void;
    (getCurrentLocation as jest.Mock).mockReturnValue(
      new Promise(done => {
        resolve = done;
      }),
    );
    const r = await open('SmartDrive');
    const from = screen(r)
      .findAllByType(TextInput)
      .find(n => n.props.accessibilityLabel === 'From')!;
    await act(async () => from.props.onChangeText('Gurugram'));
    await act(async () => resolve({ latitude: 28.6139, longitude: 77.209 }));
    expect(from.props.value).toBe('Gurugram');
  });
  test('asks one question, in the PlugOrbit voice', async () => {
    const r = await open('SmartDrive');
    expect(all(r)).toContain('Where are we going?');
    expect(all(r)).toContain('You drive. We handle the charge.');
    expect(all(r)).toContain('Battery now');
  });

  test('cannot start without a destination; then plans the trip', async () => {
    const r = await open('SmartDrive');
    expect(pressable(r, 'Start journey')?.props.disabled).toBe(true);
    const to = screen(r).findAll(
      n =>
        n.props.accessibilityLabel === 'To' &&
        typeof n.props.onChangeText === 'function',
    )[0];
    await act(async () => {
      to.props.onChangeText('Jaipur');
    });
    await flush();
    await press(r, 'Start journey');
    expect(appStore.get().smartDrive.trip?.destination.label).toBe('Jaipur');
    expect(all(r)).toContain('You’re good to drive.');
    expect(all(r)).toContain('No charging needed right now.');
  });

  test('needs a car first', async () => {
    appStore.set({ vehicles: [], activeVehicleId: null });
    const r = await open('SmartDrive');
    expect(all(r)).toContain('Add your car first');
    await press(r, 'Add your EV');
    expect(probe.current).toBe('VehicleSetup');
  });
});

describe('the trip dashboard', () => {
  test('ready to go: says so, and shows the stop and its backup already', async () => {
    seedSmartDriveTrip();
    const r = await open('SmartDrive');
    const t = all(r);
    expect(t).toContain('You’re good to drive.');
    expect(t).toContain('Delhi → Jaipur');
    expect(t).toContain('Charging needed');
    expect(t).toMatch(/PlugOrbit pick/i);
    expect(t).toMatch(/High charge confidence|Medium charge confidence/);
    expect(t).toContain('For your car: ~');
    expect(t).toMatch(/Backup: .+ ✓/);
    expect(pressable(r, 'Start driving')).toBeDefined();
  });

  test('"Start driving" sets off', async () => {
    seedSmartDriveTrip();
    const r = await open('SmartDrive');
    await press(r, 'Start driving');
    expect(appStore.get().smartDrive.trip?.phase).toBe('driving');
  });

  test('on the road it reassures, and shows that it is watching', async () => {
    seedSmartDriveTrip({ km: 20 });
    const r = await open('SmartDrive');
    const t = all(r);
    expect(t).toContain('Your trip is on track.');
    expect(t).toContain('PlugOrbit is monitoring this stop.');
    expect(t).toContain('What PlugOrbit watched');
    expect(t).toMatch(/Checked \d+ times? • told you \d+ times?/);
    expect(t).toContain('Demo drive (simulated)');
  });

  test('driving to the stop leads straight into charging, with the recommended target', async () => {
    seedSmartDriveTrip({ km: 20 });
    const target =
      appStore.get().smartDrive.trip!.primaryStop!.metrics.targetSoc;
    const r = await open('SmartDrive');
    await press(r, 'Go to the stop');
    expect(all(r)).toContain('You’ve reached your stop.');
    await press(r, 'Start charging');
    expect(probe.current).toBe('StartCharging');
    // Not the default 80%: just enough for the trip.
    expect(texts(r).join('|')).toContain(`${target}%`);
    expect(target).toBeLessThan(80);
  });

  test('a long queue at the charger changes the plan, and says so once', async () => {
    seedSmartDriveTrip({ km: 60 });
    const r = await open('SmartDrive');
    await press(r, 'Busy charger');
    const t = all(r);
    expect(t).toContain('Plan changed');
    expect(t).toMatch(/We moved your stop to/);
    const items = appStore
      .get()
      .notifications.filter(n => n.source === 'smart_drive');
    expect(items.filter(n => n.level === 'important')).toHaveLength(1);
  });

  test('a plan change can be undone', async () => {
    seedSmartDriveTrip({ km: 60 });
    const original = appStore.get().smartDrive.trip!.primaryStop!.station;
    const r = await open('SmartDrive');
    await press(r, 'Busy charger');
    expect(appStore.get().smartDrive.trip!.primaryStop!.station.id).not.toBe(
      original.id,
    );
    await press(r, new RegExp(`Keep ${original.name.replace(/[•]/g, '.')}`));
    expect(appStore.get().smartDrive.trip!.primaryStop!.station.id).toBe(
      original.id,
    );
    expect(all(r)).not.toContain('Plan changed');
  });

  test('a dead charger is replaced, with no "keep" option (it is not safe)', async () => {
    seedSmartDriveTrip({ km: 60 });
    const r = await open('SmartDrive');
    await press(r, 'Dead charger');
    expect(all(r)).toContain('Plan changed');
    expect(all(r)).not.toMatch(/Keep /);
  });

  test('losing signal keeps the plan and never shows cached status as live', async () => {
    seedSmartDriveTrip({ km: 20 });
    const r = await open('SmartDrive');
    await press(r, 'Lose signal');
    const t = all(r);
    expect(t).toContain('You’re offline.');
    expect(t).toContain('Your charging plan is still available.');
    await press(r, 'See offline plan');
    expect(probe.current).toBe('OfflineMode');
    const o = all(r);
    expect(o).toContain('Orbit Assist plan');
    expect(o).toContain('Your stop');
    expect(o).toContain('Your backup');
    expect(o).not.toMatch(/\bLIVE\b/);
    expect(o).toMatch(/last update/i);
  });

  test('"End trip" finishes it and goes home', async () => {
    seedSmartDriveTrip({ km: 20 });
    const r = await open('SmartDrive');
    await press(r, 'End trip');
    expect(appStore.get().smartDrive.trip).toBeNull();
    expect(probe.current).toBe('Home');
  });
});

describe('the charging stop screen', () => {
  test('explains the choice: why, time, cost, your car, the backup', async () => {
    seedSmartDriveTrip({ km: 100 });
    const r = await open('SmartDriveStop');
    const t = all(r);
    [
      'Charger and your car',
      'Charger capability',
      'Expected for your car',
      'Time at the stop',
      'Detour',
      'Expected wait',
      'Back to route',
      'Total trip impact',
      'What it costs',
      'Estimated stop',
      'Why this charger?',
      'If it doesn’t work out',
      'Ask PlugOrbit',
    ].forEach(s => expect(t).toContain(s));
    // Reasons, in words, never codes.
    expect(t).toContain('On your route');
    expect(t).not.toMatch(/REASON_/);
    // The honest label on a prediction that is only rules.
    expect(t).toMatch(/not a prediction model/);
  });

  test('far from the stop it declines to guess, rather than invent a forecast', async () => {
    seedSmartDriveTrip({ km: 5 });
    const r = await open('SmartDriveStop');
    expect(all(r)).toContain('Too far ahead to say');
    expect(all(r)).toContain('We don’t guess this far ahead.');
  });

  test('"charge just enough" is quantified', async () => {
    seedSmartDriveTrip({ km: 20 });
    const r = await open('SmartDriveStop');
    expect(all(r)).toMatch(/enough to finish your trip with 12% to spare/);
    expect(all(r)).toMatch(/saves about \d+ min/);
  });

  test('you can ask it things, and it answers from the plan', async () => {
    seedSmartDriveTrip({ km: 20 });
    const r = await open('SmartDriveStop');
    await press(r, 'Why are we stopping here?');
    expect(all(r)).toMatch(
      /closest reliable charger|slightly farther than the closest option/,
    );
    await press(r, 'Can I skip this charger?');
    expect(all(r)).toMatch(/You can|Skipping/);
    await press(r, 'Find me something cheaper');
    expect(all(r)).toMatch(/cheaper|lowest-cost/);
  });

  test('a cheaper option can be taken in one tap', async () => {
    seedSmartDriveTrip({ km: 20 });
    const before = appStore.get().smartDrive.trip!.primaryStop!.station.id;
    const r = await open('SmartDriveStop');
    await press(r, 'Find me something cheaper');
    const button = pressable(r, /^Switch to /);
    if (button) {
      await press(r, /^Switch to /);
      expect(appStore.get().smartDrive.trip!.primaryStop!.station.id).not.toBe(
        before,
      );
    } else {
      expect(all(r)).toMatch(/lowest-cost/);
    }
  });

  test('with nothing planned it says so', async () => {
    const r = await open('SmartDriveStop');
    expect(all(r)).toContain('No trip in progress');
    await press(r, 'Plan a journey');
    expect(probe.current).toBe('SmartDrive');
  });
});

describe('Smart Drive inside the rest of the app', () => {
  test('Home shows Orbit Assist with one calm line and one way in', async () => {
    const r = await open('Home', true);
    const t = all(r);
    expect(t).toContain('Orbit Assist');
    expect(t).toContain('You’re good to drive.');
    expect(t).toMatch(/About \d+ km before your 12% reserve\./);
    expect(t).toContain('Ready');
    await press(r, 'Plan a journey');
    expect(probe.current).toBe('SmartDrive');
  });

  test('Home shows the trip when there is one, and opens it', async () => {
    seedSmartDriveTrip({ km: 20 });
    const r = await open('Home', true);
    expect(all(r)).toContain('Your trip is on track.');
    expect(all(r)).toContain('Active');
    await press(r, 'Open trip');
    expect(probe.current).toBe('SmartDrive');
  });

  test('Home turns urgent only when the battery is low', async () => {
    appStore.set({
      battery: { percent: 12, source: 'manual', updatedAt: Date.now() },
    });
    const r = await open('Home', true);
    expect(all(r)).toContain('Battery is getting low.');
    // Running low and nowhere in particular to be: the nearest chargers, as a list.
    await press(r, 'Find chargers');
    expect(probe.current).toBe('StationList');
  });

  test('Home asks for the car before anything else', async () => {
    appStore.set({ vehicles: [], activeVehicleId: null });
    const r = await open('Home', true);
    expect(all(r)).toContain('Add your car to get started.');
    expect(all(r)).toContain('Setup needed');
    await press(r, 'Set up');
    expect(probe.current).toBe('VehicleSetup');
  });

  test('the destination typed on Home arrives in the Orbit Assist planner', async () => {
    const r = await open('Home', true);
    await act(async () => {
      r.root
        .findByProps({ testID: 'destination-input' })
        .props.onChangeText('Jaipur');
    });
    await press(r, 'Plan my journey');
    expect(probe.current).toBe('SmartDrive');
    const planner = screen(r);
    const to = planner
      .findAllByType(TextInput)
      .map(n => n.props.value)
      .filter(Boolean);
    expect(to).toContain('Jaipur');
  });

  test('Trips offers Orbit Assist up front', async () => {
    const r = await open('Trips', true);
    expect(all(r)).toContain('You drive. We handle the charge.');
    await press(r, 'Plan a journey');
    expect(probe.current).toBe('SmartDrive');
  });

  test('Notifications show how much each Smart Drive message matters', async () => {
    seedSmartDriveTrip({ km: 60 });
    const r = await open('SmartDrive');
    await press(r, 'Dead charger');
    await act(async () => {
      mounted.splice(0).forEach(m => m.unmount());
    });
    const n = await open('Notifications');
    expect(all(n)).toContain('Plan changed');
    expect(all(n)).toContain('We’ve changed your charging stop.');
  });

  test('Trip preferences: Orbit Assist settings save as you change them', async () => {
    const r = await open('TripPreferences');
    expect(all(r)).toContain('Orbit Assist on for new trips');
    expect(all(r)).toContain('Only tell me what matters');
    const toggle = screen(r).findAll(
      n =>
        n.props.accessibilityLabel === 'Only tell me what matters' &&
        typeof n.props.onValueChange === 'function',
    )[0];
    await act(async () => {
      toggle.props.onValueChange(true);
    });
    await flush();
    expect(appStore.get().smartDrive.prefs.verbosity).toBe('minimal');
  });

  const learned = () =>
    appStore.set(st => ({
      smartDrive: {
        ...st.smartDrive,
        signals: [1, 2, 3, 4, 5].map(i => ({
          at: i,
          tripId: `t${i}`,
          chosenId: 'a',
          recommendedId: 'b',
          leans: ['faster' as const],
        })),
      },
    }));

  test('learning is a suggestion you review, never a silent change', async () => {
    learned();
    const r = await open('TripPreferences');
    expect(all(r)).toContain('You usually pick faster chargers');
    expect(appStore.get().tripPrefs.strategy).toBe('reliable');
    await press(r, 'Use this');
    // It lands in the form for review; saving is still the driver's call.
    expect(appStore.get().tripPrefs.strategy).toBe('reliable');
    expect(all(r)).toContain('Save preferences');
    // And once adopted in the form, it stops nagging.
    expect(all(r)).not.toContain('You usually pick faster chargers');
  });

  test('a suggestion can be turned down for good', async () => {
    learned();
    const r = await open('TripPreferences');
    await press(r, 'Not now');
    expect(appStore.get().smartDrive.dismissed).toContain('faster');
    expect(all(r)).not.toContain('You usually pick faster chargers');
  });

  test('Offline mode still works with no route at all', async () => {
    const r = await open('OfflineMode');
    expect(all(r)).toContain('Nothing saved for offline');
  });
});

describe('Orbit Assist modes and the map companion', () => {
  const storedMode = () => assistModeOf(appStore.get().smartDrive.prefs);

  test('the planner offers Guided and Orbit Assist, defaulting to the old behaviour', async () => {
    const r = await open('SmartDrive');
    expect(all(r)).toContain('How should we help?');
    expect(all(r)).toContain('Guided');
    expect(storedMode()).toBe('assist');
    const guided = screen(r).find(
      n =>
        n.props.testID === 'mode-guided' &&
        n.props.accessibilityRole === 'radio',
    );
    const assist = screen(r).find(
      n =>
        n.props.testID === 'mode-assist' &&
        n.props.accessibilityRole === 'radio',
    );
    expect(assist.props.accessibilityState.selected).toBe(true);
    expect(guided.props.accessibilityState.selected).toBe(false);
  });

  test('choosing Guided is saved, and the planner says what Guided means', async () => {
    const r = await open('SmartDrive');
    const guided = screen(r).find(
      n =>
        n.props.testID === 'mode-guided' &&
        n.props.accessibilityRole === 'radio',
    );
    await act(async () => {
      guided.props.onPress();
    });
    await flush();
    expect(storedMode()).toBe('guided');
    expect(all(r)).toContain(
      'You decide, and we tell you what your plan needs.',
    );
    expect(
      screen(r).find(
        n =>
          n.props.testID === 'mode-guided' &&
          n.props.accessibilityRole === 'radio',
      ).props.accessibilityState.selected,
    ).toBe(true);
  });

  test('the same choice is in Trip preferences', async () => {
    const r = await open('TripPreferences');
    const guided = screen(r).find(
      n =>
        n.props.testID === 'mode-guided' &&
        n.props.accessibilityRole === 'radio',
    );
    await act(async () => {
      guided.props.onPress();
    });
    await flush();
    expect(storedMode()).toBe('guided');
  });

  test('a trip in Guided mode says so in its footer, not "watching for you"', async () => {
    seedSmartDriveTrip({ km: 20 });
    appStore.set(s => ({
      smartDrive: {
        ...s.smartDrive,
        prefs: { ...s.smartDrive.prefs, mode: 'guided' },
      },
    }));
    const r = await open('SmartDrive');
    expect(all(r)).toContain('Guided: we’ll tell you what your plan needs.');
    expect(all(r)).not.toContain('PlugOrbit is monitoring');
  });

  test('the planner is upfront that this build runs on preview data', async () => {
    const r = await open('SmartDrive');
    expect(all(r)).toContain('Preview data');
    expect(all(r)).toMatch(/simulated in this version/);
  });

  test('over the map, an active trip is one calm line that expands on tap', async () => {
    seedSmartDriveTrip({ km: 20 });
    const r = await open('Map');
    const panel = screen(r).find(n => n.props.testID === 'assist-map-panel');
    expect(panel).toBeTruthy();
    expect(all(r)).toContain('Your trip is on track.');
    // Collapsed: the reasoning is not on the map yet.
    expect(all(r)).not.toContain('Open trip');
    await press(r, /^Orbit Assist\. Your trip is on track/);
    expect(all(r)).toContain('Open trip');
    expect(all(r)).toMatch(/Mode: Orbit Assist/);
    await press(r, 'Open trip');
    expect(probe.current).toBe('SmartDrive');
  });

  test('the expanded assistant takes the map: the station card steps aside, then returns', async () => {
    seedSmartDriveTrip({ km: 20 });
    const r = await open('Map');
    // (findAll sees the component and its host view, so count presence, not matches.)
    const card = () =>
      screen(r).findAll(n => n.props.testID === 'map-card').length > 0;
    expect(card()).toBe(true);
    await press(r, /^Orbit Assist\. Your trip is on track/);
    expect(card()).toBe(false);
    // Said once: the detail already names the next stop.
    expect(all(r).split('Next stop:').length - 1).toBeLessThanOrEqual(1);
    await press(r, /^Orbit Assist\. Your trip is on track.*Hide details/);
    expect(card()).toBe(true);
  });

  test('with no trip the map has no assistant panel', async () => {
    const r = await open('Map');
    expect(
      screen(r).findAll(n => n.props.testID === 'assist-map-panel'),
    ).toHaveLength(0);
  });
});
