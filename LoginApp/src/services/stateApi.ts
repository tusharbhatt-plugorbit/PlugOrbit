import {ApiResponse, CloudError, errorCode, isRecord, request} from './backend';
import {sigOf} from '../store/signature';
import {clearSession, getIdToken} from './session';

// Cloud backup endpoints of the Backend: GET / PUT /users/me/state. Each slice is one
// field of the app's persisted store (see store/syncedKeys.ts).

export type RemoteSlice = {
  value: unknown;
  /** Changes on every write: "has this changed since I last saw it?" */
  rev: string;
  /** The app's STORE_VERSION when it was written (null = unknown, treated as 1). */
  schemaVersion: number | null;
};

// 401s that a fresh token can fix. Anything else under 401/403 ends the sign-in.
const RETRY_WITH_NEW_TOKEN = new Set(['TOKEN_EXPIRED', 'INVALID_TOKEN']);

/** An authenticated call. Refreshes the token and retries once; ends the session if still refused. */
async function authed(
  method: 'GET' | 'PUT',
  path: string,
  body?: unknown,
): Promise<ApiResponse> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getIdToken({forceRefresh: attempt > 0});
    if (!token) {
      throw new CloudError('NO_SESSION', 'Not signed in to the cloud.');
    }
    const res = await request(method, path, {body, token});
    if (!res) {
      throw new CloudError('NETWORK', 'Could not reach the server.');
    }
    if (res.status === 401 || res.status === 403) {
      const code = errorCode(res);
      if (
        attempt === 0 &&
        res.status === 401 &&
        RETRY_WITH_NEW_TOKEN.has(code ?? '')
      ) {
        continue;
      }
      await clearSession();
      throw new CloudError('AUTH_LOST', 'Your session ended.', res.status);
    }
    return res;
  }
  throw new CloudError('AUTH_LOST', 'Your session ended.');
}

function failure(res: ApiResponse): CloudError {
  const rejected = res.status === 413 || res.status === 422;
  return new CloudError(
    rejected ? 'REJECTED' : 'SERVER',
    rejected ? 'The server refused this data.' : 'The server had a problem.',
    res.status,
  );
}

/** Everything stored for the signed-in user. Slices with an unusable shape are left out. */
export async function fetchRemoteState(): Promise<Record<string, RemoteSlice>> {
  const res = await authed('GET', '/users/me/state');
  if (!res.ok) {
    throw failure(res);
  }
  const slices = isRecord(res.body) ? res.body.slices : undefined;
  if (!isRecord(slices)) {
    throw new CloudError(
      'SERVER',
      'Unexpected answer from the server.',
      res.status,
    );
  }
  const out: Record<string, RemoteSlice> = {};
  for (const [name, raw] of Object.entries(slices)) {
    if (isRecord(raw) && 'value' in raw) {
      out[name] = {
        value: raw.value,
        // A slice without a revision (not written by this Backend) is versioned by its content.
        rev:
          typeof raw.rev === 'string' ? raw.rev : `content:${sigOf(raw.value)}`,
        schemaVersion:
          typeof raw.schema_version === 'number' ? raw.schema_version : null,
      };
    }
  }
  return out;
}

/** Replaces the given slices (all or nothing). Resolves to the new revision of each. */
export async function pushState(
  slices: Record<string, unknown>,
  schemaVersion: number,
): Promise<Record<string, string>> {
  const res = await authed('PUT', '/users/me/state', {
    slices,
    schema_version: schemaVersion,
  });
  if (!res.ok) {
    throw failure(res);
  }
  const written = isRecord(res.body) ? res.body.slices : undefined;
  if (!isRecord(written)) {
    throw new CloudError(
      'SERVER',
      'Unexpected answer from the server.',
      res.status,
    );
  }
  const out: Record<string, string> = {};
  for (const name of Object.keys(slices)) {
    const entry = written[name];
    if (!isRecord(entry) || typeof entry.rev !== 'string') {
      throw new CloudError(
        'SERVER',
        'Unexpected answer from the server.',
        res.status,
      );
    }
    out[name] = entry.rev;
  }
  return out;
}
