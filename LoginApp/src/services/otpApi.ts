import {API_BASE_URL} from '../config/api';
import {sessionFromVerify} from './session';
import type {CloudSession} from './session';

// Login OTP client for the Backend's POST /auth/otp/send and /auth/otp/verify.
//
// During development the Backend emails or texts the code when it can, and
// otherwise hands it back (channel "screen") so the app can show it. If the
// Backend itself cannot be reached, debug builds generate a code on the device
// instead, so a developer is never stuck. Release builds never do that.

export type OtpChannel = 'email' | 'sms' | 'screen';

export type OtpSendResult = {
  channel: OtpChannel;
  /** True only when the code really went out by email or SMS. */
  delivered: boolean;
  /** The code itself, only when it was not delivered and must be shown on screen. */
  devCode: string | null;
  /** Seconds the code stays valid. */
  expiresIn: number;
  /** Seconds before another code may be requested. */
  resendIn: number;
  message: string;
  /** The Backend was unreachable, so the code was generated on this device. */
  viaLocalFallback: boolean;
};

/** Any failure of an OTP call. `code` is the Backend's error code when it sent one. */
export class OtpError extends Error {
  code: string;
  /** Seconds to wait before retrying, for OTP_RATE_LIMITED. */
  retryAfter?: number;

  constructor(code: string, message: string, retryAfter?: number) {
    super(message);
    this.name = 'OtpError';
    this.code = code;
    if (retryAfter !== undefined) {
      this.retryAfter = retryAfter;
    }
  }
}

const TIMEOUT_MS = 15_000;
const OTP_LENGTH = 6;
// Mirror the Backend defaults (otp_ttl_seconds, otp_resend_seconds, otp_max_attempts).
const LOCAL_TTL_SECONDS = 300;
const LOCAL_RESEND_SECONDS = 30;
const LOCAL_MAX_ATTEMPTS = 5;
const NETWORK_MESSAGE =
  'Could not reach the server. Check your connection and try again.';

type ApiResponse = {ok: boolean; status: number; body: unknown};

type LocalCode = {code: string; expiresAt: number; attemptsLeft: number};

// Codes generated on this device while the Backend was unreachable (debug
// builds only), keyed by trimmed, lower-cased identifier.
const localCodes = new Map<string, LocalCode>();

const localKey = (identifier: string) => identifier.trim().toLowerCase();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const abortedError = () => new OtpError('ABORTED', 'Request cancelled.');
const networkError = () => new OtpError('NETWORK', NETWORK_MESSAGE);

/**
 * POSTs JSON to the Backend. Resolves null when no usable HTTP answer came
 * back (network error, timeout, or a body that is not JSON). Rejects only when
 * the caller aborted.
 */
async function post(
  path: string,
  payload: unknown,
  signal?: AbortSignal,
): Promise<ApiResponse | null> {
  if (signal?.aborted) {
    throw abortedError();
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  let response: ApiResponse | null = null;
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    response = {ok: res.ok, status: res.status, body: await res.json()};
  } catch {
    // Unreachable, timed out or not JSON: no usable answer.
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
  if (signal?.aborted) {
    throw abortedError();
  }
  return response;
}

/** The Backend's structured error (`detail.code`), if the response is one. */
function toApiError(res: ApiResponse): OtpError | null {
  const detail = isRecord(res.body) ? res.body.detail : undefined;
  if (res.ok || !isRecord(detail) || typeof detail.code !== 'string') {
    return null;
  }
  const message =
    typeof detail.message === 'string'
      ? detail.message
      : `Request failed (${res.status}).`;
  const retryAfter =
    typeof detail.retry_after === 'number' ? detail.retry_after : undefined;
  return new OtpError(detail.code, message, retryAfter);
}

function toSendResult(body: unknown): OtpSendResult | null {
  if (!isRecord(body)) {
    return null;
  }
  const {channel, delivered, dev_code: devCode} = body;
  if (channel !== 'email' && channel !== 'sms' && channel !== 'screen') {
    return null;
  }
  // A screen delivery without the code would leave the user stuck.
  if (channel === 'screen' && typeof devCode !== 'string') {
    return null;
  }
  return {
    channel,
    delivered:
      typeof delivered === 'boolean' ? delivered : channel !== 'screen',
    devCode: channel === 'screen' ? (devCode as string) : null,
    expiresIn:
      typeof body.expires_in === 'number' ? body.expires_in : LOCAL_TTL_SECONDS,
    resendIn:
      typeof body.resend_in === 'number'
        ? body.resend_in
        : LOCAL_RESEND_SECONDS,
    message: typeof body.message === 'string' ? body.message : '',
    viaLocalFallback: false,
  };
}

function issueLocalCode(identifier: string): OtpSendResult {
  // Development fallback only, so Math.random is good enough.
  const code = String(Math.floor(Math.random() * 10 ** OTP_LENGTH)).padStart(
    OTP_LENGTH,
    '0',
  );
  localCodes.set(localKey(identifier), {
    code,
    expiresAt: Date.now() + LOCAL_TTL_SECONDS * 1000,
    attemptsLeft: LOCAL_MAX_ATTEMPTS,
  });
  return {
    channel: 'screen',
    delivered: false,
    devCode: code,
    expiresIn: LOCAL_TTL_SECONDS,
    resendIn: LOCAL_RESEND_SECONDS,
    message: 'Backend unreachable. Code generated on this device.',
    viaLocalFallback: true,
  };
}

function checkLocalCode(key: string, entry: LocalCode, code: string): void {
  if (Date.now() >= entry.expiresAt) {
    localCodes.delete(key);
    throw new OtpError(
      'OTP_EXPIRED',
      'This code has expired. Request a new one.',
    );
  }
  if (code === entry.code) {
    localCodes.delete(key); // Single use.
    return;
  }
  entry.attemptsLeft -= 1;
  if (entry.attemptsLeft <= 0) {
    localCodes.delete(key);
    throw new OtpError(
      'OTP_TOO_MANY_ATTEMPTS',
      'Too many incorrect attempts. Request a new code.',
    );
  }
  throw new OtpError(
    'OTP_INVALID',
    `Incorrect code. ${entry.attemptsLeft} ${
      entry.attemptsLeft === 1 ? 'attempt' : 'attempts'
    } left.`,
  );
}

/**
 * Asks the Backend to send a login code to an email address or mobile number.
 * Structured Backend errors (rate limit, delivery failed, ...) are thrown as
 * OtpError and never fall back. In debug builds, when the Backend gave no
 * usable answer, a code is generated on this device instead.
 */
export async function requestOtp(
  identifier: string,
  signal?: AbortSignal,
): Promise<OtpSendResult> {
  const response = await post('/auth/otp/send', {identifier}, signal);
  if (response) {
    const apiError = toApiError(response);
    if (apiError) {
      throw apiError;
    }
    const result = response.ok ? toSendResult(response.body) : null;
    if (result) {
      // The Backend owns this identifier's code again.
      localCodes.delete(localKey(identifier));
      return result;
    }
  }
  if (!__DEV__) {
    throw networkError();
  }
  return issueLocalCode(identifier);
}

/**
 * Checks a code. Throws OtpError unless it is right. Resolves to the cloud session the
 * Backend opened for this user, or undefined when it opened none (no Firebase on the
 * Backend, a code that was shown on screen, or a code generated on this device): the
 * app then signs in on this device only, exactly as it did before cloud backup.
 */
export async function verifyOtp(
  identifier: string,
  code: string,
  signal?: AbortSignal,
): Promise<CloudSession | undefined> {
  if (signal?.aborted) {
    throw abortedError();
  }
  const key = localKey(identifier);
  const local = localCodes.get(key);
  if (local) {
    checkLocalCode(key, local, code);
    return undefined;
  }
  const response = await post('/auth/otp/verify', {identifier, code}, signal);
  if (response) {
    const apiError = toApiError(response);
    if (apiError) {
      throw apiError;
    }
    if (
      response.ok &&
      isRecord(response.body) &&
      response.body.verified === true
    ) {
      const status = response.body.session_status;
      if (__DEV__ && typeof status === 'string' && status !== 'ready') {
        // Not an error: the user is signed in on this device, just without cloud backup.
        console.warn(
          `Signed in without cloud backup (session_status: ${status}). See Backend/.env.example (OTP_DEV_FALLBACK_SESSIONS).`,
        );
      }
      return sessionFromVerify(response.body.session) ?? undefined;
    }
  }
  throw networkError();
}

/** Test helper: forgets every code generated on this device. */
export function resetLocalOtp(): void {
  localCodes.clear();
}
