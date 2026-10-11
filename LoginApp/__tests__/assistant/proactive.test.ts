import {
  COOLDOWN_MS,
  MAX_AGE_MS,
  MAX_SPOKEN_PER_HOUR,
  judge,
  startProactive,
} from '../../src/assistant/proactive';
import {
  assistantStore,
  resetAssistantStore,
  updateSettings,
} from '../../src/assistant/store';
import {noon} from '../../src/dev/smartDriveFixtures';
import {liveSession, seedSignedIn} from '../../src/dev/testHarness';
import type {AppNotification} from '../../src/domain/types';
import {
  createSmartDriveService,
  resetSmartDriveMock,
} from '../../src/services/mock/smartDriveService';
import {appStore} from '../../src/store/appStore';
import {flush, makeRig} from '../../src/dev/assistantFakes';

const T0 = Date.UTC(2026, 9, 11, 6, 30);
const note = (over: Partial<AppNotification> = {}): AppNotification => ({
  id: `n-${Math.random()}`,
  title: 'Your charging stop is coming up',
  body: 'Neemrana is about 5 minutes ahead.',
  at: T0,
  read: false,
  level: 'action',
  source: 'smart_drive',
  target: {route: 'SmartDriveStop'},
  ...over,
});

describe('judge: what is worth saying', () => {
  const ctx = (over: Partial<Parameters<typeof judge>[1]> = {}) => ({
    seen: {},
    spokenAt: [],
    now: T0,
    ...over,
  });

  it('speaks alerts that matter and only shows the rest', () => {
    expect(judge(note({level: 'action'}), ctx()).verdict).toBe('speak');
    expect(judge(note({level: 'important'}), ctx()).verdict).toBe('speak');
    expect(judge(note({level: 'critical'}), ctx()).verdict).toBe('speak');
    expect(judge(note({level: 'info'}), ctx()).verdict).toBe('show');
  });

  it('does not repeat the same alert within its cooldown, but does afterwards', () => {
    const n = note();
    const {key} = judge(n, ctx());
    expect(judge(n, ctx({seen: {[key]: T0 - 60_000}})).verdict).toBe('skip');
    expect(
      judge(n, ctx({seen: {[key]: T0 - COOLDOWN_MS.action - 1}})).verdict,
    ).toBe('speak');
    // A different message (another charger) is a different alert.
    expect(
      judge(
        note({body: 'Hisar is about 5 minutes ahead.'}),
        ctx({seen: {[key]: T0 - 1000}}),
      ).verdict,
    ).toBe('speak');
  });

  it('critical alerts repeat sooner than routine ones', () => {
    expect(COOLDOWN_MS.critical).toBeLessThan(COOLDOWN_MS.action);
    const n = note({level: 'critical'});
    const {key} = judge(n, ctx());
    expect(
      judge(n, ctx({seen: {[key]: T0 - COOLDOWN_MS.critical - 1}})).verdict,
    ).toBe('speak');
  });

  it('caps how many are spoken per hour, except critical ones', () => {
    const spokenAt = Array.from(
      {length: MAX_SPOKEN_PER_HOUR},
      (_, i) => T0 - i * 60_000,
    );
    expect(judge(note({level: 'action'}), ctx({spokenAt})).verdict).toBe(
      'show',
    );
    expect(judge(note({level: 'critical'}), ctx({spokenAt})).verdict).toBe(
      'speak',
    );
    // Old ones no longer count.
    expect(
      judge(
        note({level: 'action'}),
        ctx({spokenAt: spokenAt.map(t => t - 3_600_000)}),
      ).verdict,
    ).toBe('speak');
  });

  it('skips alerts that are already stale', () => {
    expect(judge(note({at: T0 - MAX_AGE_MS - 1}), ctx()).verdict).toBe('skip');
  });
});

describe('coordinator', () => {
  let stop: () => void;
  beforeEach(() => {
    jest.useFakeTimers({
      now: T0,
      doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'],
    });
    seedSignedIn();
  });
  afterEach(() => {
    stop?.();
    jest.useRealTimers();
  });

  const setup = () => {
    const rig = makeRig();
    stop = startProactive(rig.controller, {now: () => Date.now()});
    return rig;
  };
  const arrive = (n: AppNotification) =>
    appStore.set(s => ({notifications: [n, ...s.notifications]}));

  it('relays an engine alert once, in the engine’s own words, with a link to the trip', async () => {
    const rig = setup();
    arrive(note({at: Date.now()}));
    await flush();
    const msgs = rig.store.get().messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      role: 'notice',
      level: 'action',
      kind: 'smart_drive_action',
    });
    expect(msgs[0].text).toBe(
      'Your charging stop is coming up. Neemrana is about 5 minutes ahead.',
    );
    expect(msgs[0].fallbacks?.[0].route).toBe('SmartDriveStop');
    expect(rig.synthesizer.spoken).toHaveLength(1);
  });

  it('does not repeat an identical alert that arrives again a minute later', async () => {
    const rig = setup();
    arrive(note({at: Date.now()}));
    jest.advanceTimersByTime(60_000);
    arrive(note({at: Date.now()}));
    await flush();
    expect(rig.store.get().messages).toHaveLength(1);
  });

  it('also remembers across a restart that it already said it', async () => {
    const first = setup();
    arrive(note({at: Date.now()}));
    await flush();
    expect(first.store.get().messages).toHaveLength(1);
    stop();
    // Same persisted dedupe record, new coordinator and a fresh transcript.
    const seen = assistantStore.get().proactiveSeen;
    const rig = makeRig();
    assistantStore.set({proactiveSeen: seen});
    stop = startProactive(rig.controller);
    arrive(note({at: Date.now()}));
    await flush();
    expect(rig.store.get().messages).toHaveLength(0);
  });

  it('does not replay what was already in the store when it started', async () => {
    appStore.set({notifications: [note({at: Date.now()})]});
    const rig = setup();
    await flush();
    expect(rig.store.get().messages).toHaveLength(0);
  });

  it('ignores notifications that do not come from the journey engine', async () => {
    const rig = setup();
    arrive(note({source: undefined, at: Date.now()}));
    await flush();
    expect(rig.store.get().messages).toHaveLength(0);
  });

  it('shows but does not speak routine info', async () => {
    const rig = setup();
    arrive(
      note({
        level: 'info',
        title: 'You’re good to drive.',
        body: 'No charging needed yet.',
        at: Date.now(),
      }),
    );
    await flush();
    expect(rig.store.get().messages).toHaveLength(1);
    expect(rig.synthesizer.spoken).toHaveLength(0);
  });

  it('stays silent in text-only mode but still shows the alert', async () => {
    const rig = setup();
    updateSettings({textOnly: true});
    arrive(note({at: Date.now()}));
    await flush();
    expect(rig.store.get().messages).toHaveLength(1);
    expect(rig.synthesizer.spoken).toHaveLength(0);
  });

  it('announces a finished charge once, labelled as an estimate', async () => {
    const rig = setup();
    const s = liveSession('active', Date.now());
    appStore.set({
      session: {
        ...s,
        startedAt: Date.now() - 10 * 60 * 60 * 1000,
        targetSoc: 80,
      },
    });
    jest.advanceTimersByTime(16_000);
    await flush();
    jest.advanceTimersByTime(60_000);
    await flush();
    const notes = rig.store
      .get()
      .messages.filter(m => m.kind === 'charging_complete');
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toMatch(
      /80 percent target, according to the app’s estimated meter/,
    );
  });

  it('stops watching when told to', async () => {
    const rig = setup();
    stop();
    arrive(note({at: Date.now()}));
    await flush();
    expect(rig.store.get().messages).toHaveLength(0);
  });
});

describe('with the real journey engine', () => {
  beforeEach(() => {
    jest.useFakeTimers({
      now: noon(),
      doNotFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'setImmediate',
        'nextTick',
        'queueMicrotask',
      ],
    });
    seedSignedIn({soc: 72});
    resetSmartDriveMock();
    resetAssistantStore();
  });
  afterEach(() => jest.useRealTimers());

  it('relays a charger going offline once, and never says the same thing twice', async () => {
    const rig = makeRig();
    const stop = startProactive(rig.controller);
    const svc = createSmartDriveService();
    await svc.start({fromLabel: 'Delhi', toLabel: 'Jaipur'});
    await svc.begin();
    await svc.advance(40);
    await svc.demo.takeOffline();
    await flush(20);
    const relayed = () =>
      rig.store.get().messages.filter(m => m.kind?.startsWith('smart_drive_'));
    const offline = relayed().filter(m => /offline right now/.test(m.text));
    expect(offline).toHaveLength(1);
    expect(offline[0].text).toMatch(/Your new stop is/);
    expect(offline[0].fallbacks?.[0].route).toBe('SmartDriveStop');
    // The engine raised it at a level worth speaking, so it was spoken.
    expect(
      rig.synthesizer.spoken.some(s => /offline right now/.test(s.text)),
    ).toBe(true);
    // Keep checking: more may be raised as the car nears the stop, but never a repeat.
    for (let i = 0; i < 3; i++) {
      await svc.tick();
      await flush(10);
    }
    const texts = relayed().map(m => m.text);
    expect(new Set(texts).size).toBe(texts.length);
    stop();
  });

  it('announces a changed destination from the new plan and remembers it', async () => {
    const rig = makeRig();
    const stop = startProactive(rig.controller);
    updateSettings({drivingMode: true});
    const svc = createSmartDriveService();
    await svc.start({fromLabel: 'Delhi', toLabel: 'Jaipur'});
    await flush();
    expect(rig.store.get().journey?.destination).toBe('Jaipur');
    expect(
      rig.store.get().messages.filter(m => m.kind === 'destination_changed'),
    ).toHaveLength(0);
    await svc.start({fromLabel: 'Delhi', toLabel: 'Agra'});
    await flush();
    const changed = rig.store
      .get()
      .messages.filter(m => m.kind === 'destination_changed');
    expect(changed).toHaveLength(1);
    expect(changed[0].text).toMatch(/^Destination changed to Agra\./);
    expect(rig.store.get().journey?.destination).toBe('Agra');
    expect(
      rig.synthesizer.spoken.some(s => /Destination changed/.test(s.text)),
    ).toBe(true); // driving mode
    stop();
  });
});
