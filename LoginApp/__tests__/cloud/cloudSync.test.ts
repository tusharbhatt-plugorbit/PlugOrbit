/**
 * @format
 */

import {createFakeCloud} from '../../src/dev/fakeCloud';
import type {FakeCloud} from '../../src/dev/fakeCloud';
import {
  loadSession,
  peekSession,
  resetSessionMemory,
  saveSession,
} from '../../src/services/session';
import {
  appStore,
  demoState,
  hydrateAppStore,
  resetAppStore,
  STORE_VERSION,
} from '../../src/store/appStore';
import {
  cloudStatus,
  detachCloudSync,
  endCloudSession,
  resetCloudSyncForTests,
  startCloudSync,
  stopCloudSync,
  syncNow,
} from '../../src/store/cloudSync';
import {createMemoryStorage, setStorage} from '../../src/store/storage';
import type {KeyValueStorage} from '../../src/store/storage';
import type {Vehicle} from '../../src/domain/types';

const vehicle = (id: string, name = id) => ({id, name} as unknown as Vehicle);

let cloud: FakeCloud;
let storage: KeyValueStorage;

const advance = (ms: number) => jest.advanceTimersByTimeAsync(ms);
const startAs = async (uid: string) => {
  await saveSession(cloud.session(uid));
  await startCloudSync();
};
const putNames = () => cloud.puts.map(p => Object.keys(p.slices).sort());

beforeEach(() => {
  jest.useFakeTimers();
  storage = createMemoryStorage();
  setStorage(storage);
  resetAppStore({signedIn: true, hydrated: true});
  resetSessionMemory();
  resetCloudSyncForTests();
  cloud = createFakeCloud();
  (globalThis as unknown as {fetch: unknown}).fetch = cloud.fetch;
});

afterEach(() => {
  stopCloudSync();
  jest.useRealTimers();
});

describe('first sign-in on a phone', () => {
  test('sample content is never uploaded, and is dropped for a real account', async () => {
    appStore.set(demoState(Date.now()));
    expect(appStore.get().history.length).toBeGreaterThan(0);

    await startAs('u1');

    const s = appStore.get();
    expect(s.accountUid).toBe('u1');
    expect(s.history).toEqual([]);
    expect(s.tickets).toEqual([]);
    expect(s.notifications).toEqual([]);
    expect(s.favouriteStationIds).toEqual([]);
    expect(s.demoSeed).toEqual({});
    expect(s.paymentMethods.length).toBeGreaterThan(0); // not synced: stays on the phone
    expect(cloud.puts).toHaveLength(0);
  });

  test("the user's own data on the phone is uploaded once, then left alone", async () => {
    appStore.set({vehicles: [vehicle('car1')], activeVehicleId: 'car1'});

    await startAs('u1');

    expect(putNames()).toEqual([['activeVehicleId', 'vehicles']]);
    expect(cloud.puts[0].schemaVersion).toBe(STORE_VERSION);
    expect(cloud.read('u1', 'vehicles')).toEqual([vehicle('car1')]);

    await syncNow();
    await advance(60_000);
    expect(cloud.puts).toHaveLength(1); // nothing left to send, and no loop
  });

  test('a new phone gets the account data instead of sample content', async () => {
    cloud.seed('u1', 'history', [{id: 'h1'}]);
    cloud.seed('u1', 'vehicles', [vehicle('c1')]);
    appStore.set(demoState(Date.now()));

    await startAs('u1');

    expect(appStore.get().history).toEqual([{id: 'h1'}]);
    expect(appStore.get().vehicles).toEqual([vehicle('c1')]);
    expect(appStore.get().tickets).toEqual([]);
    await advance(30_000);
    expect(cloud.puts).toHaveLength(0); // applying cloud data is not an edit
    expect(cloud.gets).toBe(1);
  });

  test('data on both sides is merged by id, losing nothing', async () => {
    cloud.seed('u1', 'vehicles', [vehicle('a', 'from cloud')]);
    appStore.set({vehicles: [vehicle('a', 'from phone'), vehicle('b')]});

    await startAs('u1');

    expect(appStore.get().vehicles).toEqual([
      vehicle('a', 'from cloud'),
      vehicle('b'),
    ]);
    expect(cloud.read('u1', 'vehicles')).toEqual([
      vehicle('a', 'from cloud'),
      vehicle('b'),
    ]);
  });

  test('without a cloud session nothing happens', async () => {
    await startCloudSync();
    appStore.set({favouriteStationIds: ['x']});
    await advance(60_000);
    expect(cloud.gets).toBe(0);
    expect(cloud.puts).toHaveLength(0);
    expect(cloudStatus.get().state).toBe('off');
  });
});

describe('keeping the cloud up to date', () => {
  test('an edit is uploaded after a short pause, and only that field', async () => {
    await startAs('u1');
    appStore.set({favouriteStationIds: ['x']});

    await advance(1_900);
    expect(cloud.puts).toHaveLength(0);
    await advance(200);
    expect(putNames()).toEqual([['favouriteStationIds']]);
    expect(cloud.read('u1', 'favouriteStationIds')).toEqual(['x']);
    expect(cloudStatus.get().state).toBe('idle');

    await advance(60_000);
    expect(cloud.puts).toHaveLength(1);
  });

  test('a burst of edits becomes one upload with the last value', async () => {
    await startAs('u1');
    appStore.set({favouriteStationIds: ['a']});
    await advance(500);
    appStore.set({favouriteStationIds: ['a', 'b']});
    await advance(500);
    appStore.set({favouriteStationIds: ['a', 'b', 'c']});
    await advance(2_100);

    expect(cloud.puts).toHaveLength(1);
    expect(cloud.read('u1', 'favouriteStationIds')).toEqual(['a', 'b', 'c']);
  });

  test('rewriting a field with the same content is not an edit', async () => {
    appStore.set({favouriteStationIds: ['a']});
    await startAs('u1');
    const before = cloud.puts.length;

    appStore.set({favouriteStationIds: ['a']}); // new array, same content
    await advance(10_000);

    expect(cloud.puts).toHaveLength(before);
  });

  test('changes made on another phone arrive on the next sync', async () => {
    await startAs('u1');
    cloud.seed('u1', 'language', 'hi');

    await syncNow();

    expect(appStore.get().language).toBe('hi');
    expect(cloud.puts).toHaveLength(0);
  });

  test('edited on both phones: this phone wins and replaces the cloud copy', async () => {
    await startAs('u1');
    const base = appStore.get().tripPrefs;
    appStore.set({tripPrefs: {...base, minArrivalSocPct: 20}});
    cloud.seed('u1', 'tripPrefs', {...base, minArrivalSocPct: 30});

    await syncNow();

    expect(appStore.get().tripPrefs.minArrivalSocPct).toBe(20);
    expect(
      (cloud.read('u1', 'tripPrefs') as {minArrivalSocPct: number})
        .minArrivalSocPct,
    ).toBe(20);
  });

  test('a cloud copy that went missing is uploaded again', async () => {
    appStore.set({vehicles: [vehicle('car1')]});
    await startAs('u1');
    cloud.drop('u1', 'vehicles');

    await syncNow();

    expect(cloud.read('u1', 'vehicles')).toEqual([vehicle('car1')]);
  });
});

describe('offline and failures', () => {
  test('edits made offline are kept and uploaded once the network is back', async () => {
    await startAs('u1');
    cloud.online = false;
    appStore.set({favouriteStationIds: ['x']});

    await advance(2_100);
    expect(cloudStatus.get().state).toBe('offline');
    await advance(5_000); // first retry, still offline
    expect(cloudStatus.get().state).toBe('offline');

    cloud.online = true;
    await advance(10_000); // retries back off: 5s, 10s, ...
    expect(cloud.read('u1', 'favouriteStationIds')).toEqual(['x']);
    expect(cloudStatus.get().state).toBe('idle');
  });

  test('pending edits survive a restart and upload on the next launch', async () => {
    await startAs('u1');
    cloud.online = false;
    appStore.set({favouriteStationIds: ['x']});
    await advance(2_100);
    expect(cloudStatus.get().state).toBe('offline');

    // "Restart": all in-memory state is gone; the store content and storage remain.
    resetCloudSyncForTests();
    resetSessionMemory();
    cloud.online = true;
    await startCloudSync();

    expect(cloud.read('u1', 'favouriteStationIds')).toEqual(['x']);
  });

  test('a field the Backend refuses is reported, does not block the rest, and is not retried forever', async () => {
    await startAs('u1');
    cloud.rejectSlices.add('tickets');
    appStore.set({tickets: [{id: 't1'} as never], favouriteStationIds: ['x']});

    await advance(2_100);

    expect(cloud.read('u1', 'favouriteStationIds')).toEqual(['x']);
    expect(cloud.read('u1', 'tickets')).toBeUndefined();
    expect(cloudStatus.get()).toMatchObject({
      state: 'error',
      error: 'Some data could not be backed up.',
    });
    const puts = cloud.puts.length;
    await advance(10 * 60_000);
    expect(cloud.puts).toHaveLength(puts); // same payload is not sent again

    cloud.rejectSlices.clear();
    appStore.set({tickets: [{id: 't1'}, {id: 't2'}] as never});
    await advance(2_100);
    expect(cloud.read('u1', 'tickets')).toEqual([{id: 't1'}, {id: 't2'}]);
    expect(cloudStatus.get().state).toBe('idle');
  });

  test('data a newer app version wrote is neither applied nor overwritten, and does not loop', async () => {
    cloud.seed('u1', 'history', [{id: 'future-shape'}], STORE_VERSION + 1);
    appStore.set({history: [{id: 'mine'}] as never});

    await startAs('u1');
    await advance(60_000);

    expect(appStore.get().history).toEqual([{id: 'mine'}]);
    expect(cloud.read('u1', 'history')).toEqual([{id: 'future-shape'}]);
    expect(cloud.gets).toBe(1);
  });

  test('malformed cloud data is ignored instead of crashing the app', async () => {
    cloud.seed('u1', 'history', 'not a list');
    cloud.seed('u1', 'language', 'klingon');
    cloud.seed('u1', 'vehicles', [1, 2]);

    await startAs('u1');

    expect(appStore.get().history).toEqual([]);
    expect(appStore.get().language).toBe('en');
    expect(appStore.get().vehicles).toEqual([]);
  });

  test('settings from an older app version get todays defaults filled in', async () => {
    cloud.seed('u1', 'alertPrefs', {started: false});

    await startAs('u1');

    expect(appStore.get().alertPrefs).toEqual({
      started: false,
      reached80: true,
      ended: true,
      paymentDone: false,
      idleFeeWarning: false,
    });
  });
});

describe('the cloud session', () => {
  test('a token about to expire is refreshed first', async () => {
    await saveSession(cloud.session('u1', {expiresInMs: 30_000}));
    const before = peekSession()?.idToken;

    await startCloudSync();

    expect(cloud.refreshes).toBe(1);
    expect(peekSession()?.idToken).not.toBe(before);
    expect(cloud.gets).toBe(1);
  });

  test('a token the Backend rejects as expired is refreshed and the call retried once', async () => {
    const session = cloud.session('u1');
    await saveSession(session);
    cloud.expireToken(session.idToken);

    await startCloudSync();

    expect(cloud.refreshes).toBe(1);
    expect(cloud.gets).toBe(1);
    expect(cloudStatus.get().state).toBe('idle');
  });

  test('when the sign-in is over, the session is dropped, sync stops and local data is kept', async () => {
    appStore.set({vehicles: [vehicle('car1')]});
    await saveSession(cloud.session('u1', {expiresInMs: 30_000}));
    cloud.refreshError = {status: 401, code: 'INVALID_REFRESH_TOKEN'};

    await startCloudSync();

    expect(await loadSession()).toBeNull();
    expect(appStore.get().vehicles).toEqual([vehicle('car1')]);
    expect(cloudStatus.get().state).toBe('off');
    appStore.set({favouriteStationIds: ['x']});
    await advance(60_000);
    expect(cloud.puts).toHaveLength(0);
  });
});

describe('signing out and switching accounts', () => {
  test('signing out uploads pending edits first, then forgets the session', async () => {
    await startAs('u1');
    appStore.set({favouriteStationIds: ['x']}); // still inside the 2s pause

    await endCloudSession();

    expect(cloud.read('u1', 'favouriteStationIds')).toEqual(['x']);
    expect(await loadSession()).toBeNull();
  });

  test('signing out offline is not held up', async () => {
    await startAs('u1');
    cloud.online = false;
    appStore.set({favouriteStationIds: ['x']});

    const done = endCloudSession();
    await advance(4_100);
    await done;

    expect(await loadSession()).toBeNull();
    expect(appStore.get().favouriteStationIds).toEqual(['x']); // still on the phone
  });

  test("another account's data on the phone is cleared, never shown or uploaded", async () => {
    await startAs('u1');
    appStore.set({
      vehicles: [vehicle('u1-car')],
      history: [{id: 'u1-session'}] as never,
    });
    await advance(2_100);
    await endCloudSession();
    cloud.seed('u2', 'tripPrefs', {
      minArrivalSocPct: 33,
      strategy: 'fastest',
      avoidPaidParking: false,
      preferAmenities: true,
    });

    await startAs('u2');

    const s = appStore.get();
    expect(s.accountUid).toBe('u2');
    expect(s.vehicles).toEqual([]);
    expect(s.history).toEqual([]);
    expect(s.tripPrefs.minArrivalSocPct).toBe(33);
    expect(cloud.names('u2')).toEqual(['tripPrefs']); // nothing of u1 reached u2
    expect(cloud.read('u1', 'vehicles')).toEqual([vehicle('u1-car')]); // u1's copy untouched
  });

  test('the same user signing back in uploads what changed while signed out', async () => {
    await startAs('u1');
    await endCloudSession();
    appStore.set({favouriteStationIds: ['offline-edit']});

    await startAs('u1');

    expect(cloud.read('u1', 'favouriteStationIds')).toEqual(['offline-edit']);
  });

  test('the presenter reset detaches the phone so sample data never reaches the account', async () => {
    appStore.set({vehicles: [vehicle('car1')]});
    await startAs('u1');

    await detachCloudSync();
    appStore.replace({...appStore.get(), ...demoState(Date.now())});
    await advance(60_000);

    expect(peekSession()).toBeNull();
    expect(cloud.read('u1', 'vehicles')).toEqual([vehicle('car1')]);
    expect(cloud.puts).toHaveLength(1); // only the original upload
  });
});

describe('starting the app', () => {
  const blob = (d: object) => JSON.stringify({v: STORE_VERSION, d});

  test('a phone linked to an account is not re-filled with sample content', async () => {
    setStorage(
      createMemoryStorage({
        'plugorbit/app': blob({accountUid: 'u1', signedIn: true}),
      }),
    );
    resetAppStore();
    await hydrateAppStore();
    expect(appStore.get().history).toEqual([]);
    expect(appStore.get().paymentMethods).toEqual([]);
  });

  test('a phone that was never linked still gets the sample content', async () => {
    setStorage(createMemoryStorage());
    resetAppStore();
    await hydrateAppStore();
    expect(appStore.get().history.length).toBeGreaterThan(0);
    expect(Object.keys(appStore.get().demoSeed).sort()).toEqual([
      'favouriteStationIds',
      'history',
      'notifications',
      'savedRoutes',
      'tickets',
    ]);
  });
});
