/**
 * @format
 */

import {SYNCED_KEYS} from '../../src/store/syncedKeys';

// Plain Node modules; the app's TypeScript config carries no Node typings.
declare const __dirname: string;
const {existsSync, readFileSync} = require('fs') as {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, encoding: 'utf8') => string;
};
const {join} = require('path') as {join: (...parts: string[]) => string};

// The Backend refuses any field it does not list (SLICE_TYPES in
// Backend/app/services/app_state.py), so a drift between the two lists would silently
// stop a field from being backed up. Skipped if the Backend folder is not checked out.
const BACKEND_FILE = join(
  __dirname,
  '..',
  '..',
  '..',
  'Backend',
  'app',
  'services',
  'app_state.py',
);

const backendKeys = (): string[] => {
  const source = readFileSync(BACKEND_FILE, 'utf8');
  const start = source.indexOf('SLICE_TYPES');
  const end = source.indexOf('\n}', start);
  return [...source.slice(start, end).matchAll(/^\s+"(\w+)":/gm)].map(
    m => m[1],
  );
};

(existsSync(BACKEND_FILE) ? describe : describe.skip)(
  'backed-up fields match the Backend',
  () => {
    test('the same names on both sides', () => {
      expect([...SYNCED_KEYS].sort()).toEqual(backendKeys().sort());
    });

    test('paymentMethods and in-flight state are not backed up', () => {
      const keys: readonly string[] = SYNCED_KEYS;
      for (const private_ of [
        'paymentMethods',
        'session',
        'reservation',
        'queue',
        'signedIn',
        'accountUid',
        'demoSeed',
      ]) {
        expect(keys).not.toContain(private_);
      }
    });
  },
);
