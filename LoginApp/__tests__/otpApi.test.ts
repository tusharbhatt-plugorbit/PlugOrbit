/**
 * @format
 */

import {API_BASE_URL} from '../src/config/api';
import {
  OtpError,
  requestOtp,
  resetLocalOtp,
  verifyOtp,
} from '../src/services/otpApi';

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const sendBody = (overrides: Record<string, unknown> = {}) => ({
  message: 'Verification code sent.',
  identifier_type: 'email',
  channel: 'email',
  delivered: true,
  dev_code: null,
  expires_in: 300,
  resend_in: 30,
  ...overrides,
});

const apiError = (status: number, detail: Record<string, unknown>) =>
  jsonResponse(status, {detail});

const NETWORK_MESSAGE =
  'Could not reach the server. Check your connection and try again.';

const fetchMock = jest.fn();

// Resolves to the OtpError a call rejects with.
const failureOf = async (call: Promise<unknown>) => {
  try {
    await call;
  } catch (e) {
    return e as OtpError;
  }
  throw new Error('Expected the call to reject.');
};

// Fake timers for the whole file (see App.test.tsx for why they are not swapped
// per test).
beforeAll(() => {
  jest.useFakeTimers();
});

beforeEach(() => {
  resetLocalOtp();
  fetchMock.mockReset();
  fetchMock.mockRejectedValue(new TypeError('Network request failed'));
  (globalThis as any).fetch = fetchMock;
  (globalThis as any).__DEV__ = true;
});

afterEach(() => {
  (globalThis as any).__DEV__ = true;
});

afterAll(() => {
  jest.useRealTimers();
});

describe('requestOtp with a working Backend', () => {
  test('posts the identifier and maps an email delivery', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, sendBody()));

    const result = await requestOtp('name@example.com');

    expect(result).toEqual({
      channel: 'email',
      delivered: true,
      devCode: null,
      expiresIn: 300,
      resendIn: 30,
      message: 'Verification code sent.',
      viaLocalFallback: false,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE_URL}/auth/otp/send`);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({identifier: 'name@example.com'});
  });

  test('maps an SMS delivery', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, sendBody({channel: 'sms', identifier_type: 'phone'})),
    );
    const result = await requestOtp('+91 98765 43210');
    expect(result).toMatchObject({channel: 'sms', delivered: true});
  });

  test('hands back the code when the Backend could not deliver it', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        200,
        sendBody({channel: 'screen', delivered: false, dev_code: '246810'}),
      ),
    );

    const result = await requestOtp('name@example.com');

    expect(result).toMatchObject({
      channel: 'screen',
      delivered: false,
      devCode: '246810',
      viaLocalFallback: false,
    });
  });

  test('structured errors are thrown as OtpError with their code and retry_after', async () => {
    fetchMock.mockResolvedValue(
      apiError(429, {
        code: 'OTP_RATE_LIMITED',
        message: 'Please wait 20 seconds.',
        retry_after: 20,
      }),
    );

    const error = await failureOf(requestOtp('name@example.com'));

    expect(error).toBeInstanceOf(OtpError);
    expect(error).toMatchObject({
      code: 'OTP_RATE_LIMITED',
      message: 'Please wait 20 seconds.',
      retryAfter: 20,
    });
  });

  test.each([
    ['INVALID_IDENTIFIER', 400],
    ['OTP_DELIVERY_FAILED', 503],
  ])('%s never falls back to a device code', async (code, status) => {
    fetchMock.mockResolvedValue(apiError(status, {code, message: 'Nope.'}));

    const error = await failureOf(requestOtp('name@example.com'));

    expect(error.code).toBe(code);
    // No device code was stored: verifying goes to the Backend.
    fetchMock.mockResolvedValue(
      jsonResponse(200, {verified: true, message: 'ok'}),
    );
    await verifyOtp('name@example.com', '123456');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('requestOtp when the Backend gives no usable answer (debug build)', () => {
  const expectDeviceCode = (result: Awaited<ReturnType<typeof requestOtp>>) => {
    expect(result).toMatchObject({
      channel: 'screen',
      delivered: false,
      viaLocalFallback: true,
      expiresIn: 300,
      resendIn: 30,
    });
    expect(result.devCode).toMatch(/^\d{6}$/);
  };

  test('a network error falls back to a code generated on the device', async () => {
    expectDeviceCode(await requestOtp('name@example.com'));
  });

  test('a response from some other server falls back too', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, {detail: 'Not Found'}));
    expectDeviceCode(await requestOtp('name@example.com'));

    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    });
    expectDeviceCode(await requestOtp('name@example.com'));

    fetchMock.mockResolvedValue(jsonResponse(200, {hello: 'world'}));
    expectDeviceCode(await requestOtp('name@example.com'));

    // "Screen" without a code would leave the user stuck.
    fetchMock.mockResolvedValue(
      jsonResponse(200, sendBody({channel: 'screen', dev_code: null})),
    );
    expectDeviceCode(await requestOtp('name@example.com'));
  });

  test('a timeout falls back', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: {signal: AbortSignal}) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(new Error('Aborted')),
          );
        }),
    );

    const pending = requestOtp('name@example.com');
    jest.advanceTimersByTime(15_000);

    expectDeviceCode(await pending);
  });

  test('the device code verifies once, ignoring case and spacing of the identifier', async () => {
    const {devCode} = await requestOtp('  Name@Example.com ');

    await expect(
      verifyOtp('name@example.com', devCode!),
    ).resolves.toBeUndefined();
    // Local verification never calls the Backend, and the code is single use.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const error = await failureOf(verifyOtp('name@example.com', devCode!));
    expect(error.code).toBe('NETWORK');
  });

  test('a new code replaces the old one', async () => {
    const first = (await requestOtp('name@example.com')).devCode!;
    let second = first;
    while (second === first) {
      second = (await requestOtp('name@example.com')).devCode!;
    }

    const error = await failureOf(verifyOtp('name@example.com', first));
    expect(error.code).toBe('OTP_INVALID');
    await expect(
      verifyOtp('name@example.com', second),
    ).resolves.toBeUndefined();
  });

  test('five wrong tries use the code up', async () => {
    const {devCode} = await requestOtp('name@example.com');
    const wrong = devCode === '000000' ? '111111' : '000000';

    const messages: string[] = [];
    for (let i = 0; i < 4; i++) {
      const error = await failureOf(verifyOtp('name@example.com', wrong));
      expect(error.code).toBe('OTP_INVALID');
      messages.push(error.message);
    }
    expect(messages).toEqual([
      'Incorrect code. 4 attempts left.',
      'Incorrect code. 3 attempts left.',
      'Incorrect code. 2 attempts left.',
      'Incorrect code. 1 attempt left.',
    ]);
    const last = await failureOf(verifyOtp('name@example.com', wrong));
    expect(last.code).toBe('OTP_TOO_MANY_ATTEMPTS');
    // Even the right code no longer works.
    const afterwards = await failureOf(verifyOtp('name@example.com', devCode!));
    expect(afterwards.code).toBe('NETWORK');
  });

  test('the code expires after five minutes', async () => {
    const {devCode} = await requestOtp('name@example.com');

    jest.advanceTimersByTime(5 * 60_000 + 1);

    const error = await failureOf(verifyOtp('name@example.com', devCode!));
    expect(error.code).toBe('OTP_EXPIRED');
  });

  test('a Backend answer for the identifier retires its device code', async () => {
    const {devCode} = await requestOtp('name@example.com');
    fetchMock.mockResolvedValue(jsonResponse(200, sendBody()));
    await requestOtp('name@example.com');

    fetchMock.mockResolvedValue(
      apiError(400, {code: 'OTP_INVALID', message: 'Incorrect code.'}),
    );
    const error = await failureOf(verifyOtp('name@example.com', devCode!));
    expect(error.message).toBe('Incorrect code.');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('requestOtp in a release build', () => {
  test('an unreachable Backend is an error, never a device code', async () => {
    (globalThis as any).__DEV__ = false;

    const error = await failureOf(requestOtp('name@example.com'));

    expect(error).toBeInstanceOf(OtpError);
    expect(error).toMatchObject({code: 'NETWORK', message: NETWORK_MESSAGE});
  });

  test('so is an answer from some other server', async () => {
    (globalThis as any).__DEV__ = false;
    fetchMock.mockResolvedValue(jsonResponse(404, {detail: 'Not Found'}));

    const error = await failureOf(requestOtp('name@example.com'));

    expect(error.code).toBe('NETWORK');
  });

  test('structured errors are unchanged', async () => {
    (globalThis as any).__DEV__ = false;
    fetchMock.mockResolvedValue(
      apiError(503, {code: 'OTP_DELIVERY_FAILED', message: 'Try later.'}),
    );

    const error = await failureOf(requestOtp('name@example.com'));

    expect(error).toMatchObject({
      code: 'OTP_DELIVERY_FAILED',
      message: 'Try later.',
    });
  });
});

describe('cancelling', () => {
  test('a caller abort rejects without falling back', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(
      (_url: string, init: {signal: AbortSignal}) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(new Error('Aborted')),
          );
        }),
    );

    const pending = requestOtp('name@example.com', controller.signal);
    controller.abort();

    const error = await failureOf(pending);
    expect(error.code).toBe('ABORTED');
    // No device code was created for the cancelled request.
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    const afterwards = await failureOf(verifyOtp('name@example.com', '123456'));
    expect(afterwards.code).toBe('NETWORK');
  });

  test('a response that arrives after the abort is ignored', async () => {
    const controller = new AbortController();
    let respond!: (value: unknown) => void;
    fetchMock.mockReturnValue(
      new Promise(resolve => {
        respond = resolve;
      }),
    );

    const pending = requestOtp('name@example.com', controller.signal);
    controller.abort();
    respond(jsonResponse(200, sendBody()));

    expect((await failureOf(pending)).code).toBe('ABORTED');
  });

  test('an already aborted signal never reaches the network', async () => {
    const controller = new AbortController();
    controller.abort();

    expect(
      (await failureOf(requestOtp('name@example.com', controller.signal))).code,
    ).toBe('ABORTED');
    expect(
      (
        await failureOf(
          verifyOtp('name@example.com', '123456', controller.signal),
        )
      ).code,
    ).toBe('ABORTED');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('verifyOtp against the Backend', () => {
  test('posts the identifier and code', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {verified: true, message: 'Verified.'}),
    );

    await expect(
      verifyOtp('name@example.com', '123456'),
    ).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE_URL}/auth/otp/verify`);
    expect(JSON.parse(init.body)).toEqual({
      identifier: 'name@example.com',
      code: '123456',
    });
  });

  test('hands back the cloud session when the Backend opened one', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        verified: true,
        message: 'Verified.',
        session_status: 'ready',
        session: {
          id_token: 'ID',
          refresh_token: 'RT',
          expires_in: 3600,
          user: {uid: 'u1'},
        },
      }),
    );

    const session = await verifyOtp('name@example.com', '123456');

    expect(session).toMatchObject({
      uid: 'u1',
      idToken: 'ID',
      refreshToken: 'RT',
    });
    expect(session!.expiresAt).toBeGreaterThan(Date.now());
  });

  test.each([
    ['dev_code', {session_status: 'dev_code'}],
    ['unavailable', {session_status: 'unavailable'}],
    ['a session that is malformed', {session: {id_token: 'ID'}}],
  ])('%s signs in on this device only', async (_name, extra) => {
    jest.spyOn(console, 'warn').mockImplementation(() => {}); // the dev hint
    fetchMock.mockResolvedValue(
      jsonResponse(200, {verified: true, message: 'Verified.', ...extra}),
    );

    await expect(
      verifyOtp('name@example.com', '123456'),
    ).resolves.toBeUndefined();
  });

  test.each([
    ['OTP_INVALID', 400],
    ['OTP_EXPIRED', 400],
    ['OTP_TOO_MANY_ATTEMPTS', 429],
  ])('%s is surfaced with its message', async (code, status) => {
    fetchMock.mockResolvedValue(
      apiError(status, {code, message: `Message for ${code}.`}),
    );

    const error = await failureOf(verifyOtp('name@example.com', '123456'));

    expect(error).toMatchObject({code, message: `Message for ${code}.`});
  });

  test('an unreachable Backend cannot be verified against', async () => {
    const error = await failureOf(verifyOtp('name@example.com', '123456'));

    expect(error).toMatchObject({code: 'NETWORK', message: NETWORK_MESSAGE});
  });

  test('a 200 that is not a verification is not trusted', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {verified: false}));

    const error = await failureOf(verifyOtp('name@example.com', '123456'));

    expect(error.code).toBe('NETWORK');
  });
});
