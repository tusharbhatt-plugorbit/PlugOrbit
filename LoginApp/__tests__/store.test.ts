/**
 * @format
 */

import {resumeSession} from '../src/app/initialStack';
import {liveSession} from '../src/dev/testHarness';
import {
  appStore,
  flushAppStore,
  hydrateAppStore,
  resetAppData,
  resetAppStore,
} from '../src/store/appStore';
import {createMemoryStorage, setStorage} from '../src/store/storage';

describe('Reset demo data keeps persistence alive', () => {
  afterEach(() => {
    resetAppStore();
    setStorage(createMemoryStorage());
  });

  test('the reset is written through, and later changes are still saved', async () => {
    const storage = createMemoryStorage();
    setStorage(storage);
    resetAppStore();
    await hydrateAppStore();

    await resetAppData({signedIn: true, hydrated: true, history: []});
    const afterReset = JSON.parse((await storage.getItem('plugorbit/app'))!);
    expect(afterReset.d.session).toBeNull();
    expect(afterReset.d.signedIn).toBe(true);

    // The regression: persistence used to stop here, so this was never saved.
    appStore.set({
      battery: {percent: 33, source: 'manual', updatedAt: 1},
      session: liveSession('active'),
    });
    await flushAppStore();
    const saved = JSON.parse((await storage.getItem('plugorbit/app'))!);
    expect(saved.d.battery.percent).toBe(33);
    expect(saved.d.session.status).toBe('active');
  });
});

describe('resumeSession', () => {
  const nav = () => ({navigate: jest.fn()});

  afterEach(() => resetAppStore());

  test('does nothing without a session', () => {
    resetAppStore();
    const n = nav();
    resumeSession(n as never);
    expect(n.navigate).not.toHaveBeenCalled();
  });

  test.each([
    ['active', 'ActiveSession', undefined],
    ['payment_due', 'Payment', {sessionId: 'PO-LIVE01'}],
    ['payment_failed', 'PaymentFailure', {sessionId: 'PO-LIVE01'}],
  ] as const)('%s opens %s with the params it needs', (status, name, params) => {
    resetAppStore({session: liveSession(status)});
    const n = nav();
    resumeSession(n as never);
    expect(n.navigate).toHaveBeenCalledWith(name, params);
  });
});
