import {API_BASE_URL} from '../config/api';

// Plain HTTP access to the PlugOrbit Backend for the signed-in features (session refresh,
// cloud backup). The login code client (otpApi.ts) has its own copy with its own
// development fallbacks; nothing here ever invents an answer.

export type ApiResponse = {ok: boolean; status: number; body: unknown};

const TIMEOUT_MS = 20_000;

/** Any failure talking to the Backend. `code` is stable, `status` the HTTP status if one came back. */
export class CloudError extends Error {
  code: CloudErrorCode;
  status?: number;

  constructor(code: CloudErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'CloudError';
    this.code = code;
    if (status !== undefined) {
      this.status = status;
    }
  }
}

export type CloudErrorCode =
  | 'NETWORK' // no usable answer: offline, timeout, unreachable
  | 'NO_SESSION' // nobody is signed in to the cloud
  | 'AUTH_LOST' // the session is no longer valid and was cleared
  | 'REJECTED' // the Backend refused this data (validation, size)
  | 'SERVER'; // the Backend answered with an error

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * One JSON request. Resolves null when no usable HTTP answer came back (network
 * error or timeout); a non-JSON body comes back as `body: null`.
 */
export async function request(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  options: {body?: unknown; token?: string} = {},
): Promise<ApiResponse | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {Accept: 'application/json'};
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (options.token) {
      headers.Authorization = `Bearer ${options.token}`;
    }
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // empty or not JSON
    }
    return {ok: res.ok, status: res.status, body};
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The Backend's structured error code (`detail.code`), if the response carries one. */
export function errorCode(res: ApiResponse): string | null {
  const detail = isRecord(res.body) ? res.body.detail : undefined;
  return isRecord(detail) && typeof detail.code === 'string'
    ? detail.code
    : null;
}
