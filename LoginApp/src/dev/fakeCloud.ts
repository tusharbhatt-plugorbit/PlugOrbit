import type {CloudSession} from '../services/session';

// An in-memory stand-in for the Backend's session + cloud backup endpoints, for tests:
//   POST /auth/refresh      GET / PUT /users/me/state
// It follows the real contract (Backend/app/routes/users.py, services/app_state.py): a fresh
// `rev` per write, all-or-nothing PUT, coded errors. Install it as `global.fetch`.

type Doc = {value: unknown; rev: string; schemaVersion: number};

type FakeResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

const respond = (status: number, body: unknown): FakeResponse => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const error = (status: number, code: string) =>
  respond(status, {detail: {code, message: code}});

export type FakeCloud = {
  /** Assign to globalThis.fetch. */
  fetch: (
    url: string,
    init?: {method?: string; headers?: Record<string, string>; body?: string},
  ) => Promise<FakeResponse>;
  /** Network switch: false makes every request fail like an unreachable server. */
  online: boolean;
  /** Slice names the Backend refuses with 422 (the whole PUT is refused). */
  rejectSlices: Set<string>;
  /** Make /auth/refresh answer with this error code (e.g. INVALID_REFRESH_TOKEN), or null. */
  refreshError: {status: number; code: string} | null;
  /** Requests seen so far. */
  gets: number;
  puts: Array<{slices: Record<string, unknown>; schemaVersion: number}>;
  refreshes: number;
  /** A signed-in session for `uid`, as /auth/otp/verify would hand it out. */
  session: (uid: string, options?: {expiresInMs?: number}) => CloudSession;
  /** Make the ID token stop being accepted (the Backend answers 401 TOKEN_EXPIRED). */
  expireToken: (idToken: string) => void;
  /** Put a slice in the cloud without going through the app. */
  seed: (
    uid: string,
    name: string,
    value: unknown,
    schemaVersion?: number,
  ) => void;
  /** Remove a slice from the cloud. */
  drop: (uid: string, name: string) => void;
  /** What the cloud holds for a user. */
  read: (uid: string, name: string) => unknown;
  names: (uid: string) => string[];
};

export function createFakeCloud(): FakeCloud {
  const accounts = new Map<string, Map<string, Doc>>();
  const idTokens = new Map<string, string>(); // idToken -> uid
  const refreshTokens = new Map<string, string>(); // refreshToken -> uid
  const expired = new Set<string>();
  let counter = 0;

  const docs = (uid: string) => {
    let account = accounts.get(uid);
    if (!account) {
      account = new Map();
      accounts.set(uid, account);
    }
    return account;
  };
  const mint = (uid: string) => {
    counter += 1;
    const idToken = `id-${uid}-${counter}`;
    const refreshToken = `rt-${uid}-${counter}`;
    idTokens.set(idToken, uid);
    refreshTokens.set(refreshToken, uid);
    return {idToken, refreshToken};
  };

  const cloud: FakeCloud = {
    online: true,
    rejectSlices: new Set(),
    refreshError: null,
    gets: 0,
    puts: [],
    refreshes: 0,

    session(uid, options = {}) {
      const {idToken, refreshToken} = mint(uid);
      return {
        uid,
        idToken,
        refreshToken,
        expiresAt: Date.now() + (options.expiresInMs ?? 3_600_000),
      };
    },
    expireToken: idToken => {
      expired.add(idToken);
    },
    seed(uid, name, value, schemaVersion = 1) {
      counter += 1;
      docs(uid).set(name, {value, rev: `rev-${counter}`, schemaVersion});
    },
    drop: (uid, name) => {
      docs(uid).delete(name);
    },
    read: (uid, name) => docs(uid).get(name)?.value,
    names: uid => [...docs(uid).keys()],

    async fetch(url, init = {}) {
      if (!cloud.online) {
        throw new TypeError('Network request failed');
      }
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      const method = init.method ?? 'GET';
      const body = init.body ? JSON.parse(init.body) : undefined;

      if (method === 'POST' && path === '/auth/refresh') {
        cloud.refreshes += 1;
        if (cloud.refreshError) {
          return error(cloud.refreshError.status, cloud.refreshError.code);
        }
        const uid = refreshTokens.get(body?.refresh_token);
        if (!uid) {
          return error(401, 'INVALID_REFRESH_TOKEN');
        }
        const next = mint(uid);
        return respond(200, {
          id_token: next.idToken,
          refresh_token: next.refreshToken,
          expires_in: 3600,
        });
      }

      if (path === '/users/me/state') {
        const bearer = /^Bearer (.+)$/.exec(init.headers?.Authorization ?? '');
        if (!bearer) {
          return error(401, 'MISSING_TOKEN');
        }
        if (expired.has(bearer[1])) {
          return error(401, 'TOKEN_EXPIRED');
        }
        const uid = idTokens.get(bearer[1]);
        if (!uid) {
          return error(401, 'INVALID_TOKEN');
        }
        if (method === 'GET') {
          cloud.gets += 1;
          const slices: Record<string, unknown> = {};
          docs(uid).forEach((doc, name) => {
            slices[name] = {
              value: doc.value,
              rev: doc.rev,
              updated_at: '2026-01-01T00:00:00Z',
              schema_version: doc.schemaVersion,
            };
          });
          return respond(200, {slices});
        }
        if (method === 'PUT') {
          const incoming = (body?.slices ?? {}) as Record<string, unknown>;
          const names = Object.keys(incoming);
          if (
            names.length === 0 ||
            names.some(n => cloud.rejectSlices.has(n))
          ) {
            return error(422, 'INVALID_SLICE');
          }
          const schemaVersion = body?.schema_version ?? 1;
          cloud.puts.push({slices: incoming, schemaVersion});
          const written: Record<string, unknown> = {};
          names.forEach(name => {
            counter += 1;
            const rev = `rev-${counter}`;
            docs(uid).set(name, {value: incoming[name], rev, schemaVersion});
            written[name] = {rev, updated_at: '2026-01-01T00:00:01Z'};
          });
          return respond(200, {slices: written});
        }
      }
      return error(404, 'NOT_FOUND');
    },
  };
  return cloud;
}
