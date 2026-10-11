import { CloudError } from '../../src/services/backend';
import { GatewayError, createGateway } from '../../src/assistant/gateway';
import type { Transport, TransportRequest } from '../../src/assistant/gateway';
import type { StreamEvent } from '../../src/assistant/types';

const line = (e: object) => JSON.stringify(e) + '\n';

test('status checks time out even when token refresh never resolves', async () => {
  jest.useFakeTimers();
  try {
    const gateway = createGateway({
      idleTimeoutMs: 50,
      getToken: () => new Promise(() => undefined),
    });
    const status = gateway.status();
    // Attach the rejection assertion before advancing the timeout.
    // eslint-disable-next-line jest/valid-expect
    const assertion = expect(status).rejects.toMatchObject({ code: 'TIMEOUT' });
    await jest.advanceTimersByTimeAsync(51);
    await assertion;
  } finally {
    jest.useRealTimers();
  }
});

function transportOf(
  handler: (
    req: TransportRequest,
    attempt: number,
  ) =>
    | Promise<{ status: number; body: string; retryAfter?: number }>
    | { status: number; body: string; retryAfter?: number },
) {
  const calls: TransportRequest[] = [];
  const t: Transport = async req => {
    calls.push(req);
    return handler(req, calls.length);
  };
  return { t, calls };
}

const tokens = (...values: Array<string | null>) => {
  let i = 0;
  return jest.fn(async () => values[Math.min(i++, values.length - 1)]);
};

describe('streaming a turn', () => {
  it('delivers events as chunks arrive, even when lines are split', async () => {
    const events: StreamEvent[] = [];
    const a = line({
      type: 'session',
      session_id: 's',
      turn_id: 't',
      resumed: false,
    });
    const b = line({ type: 'text', delta: 'Hello' });
    const c = line({ type: 'done', outcome: 'ok', usage: {}, sources: [] });
    const { t, calls } = transportOf(req => {
      const all = a + b + c;
      req.onChunk?.(all.slice(0, a.length + 10)); // a whole line and a bit of the next
      req.onChunk?.(all.slice(a.length + 10, a.length + b.length + 3));
      req.onChunk?.(all.slice(a.length + b.length + 3));
      return { status: 200, body: all };
    });
    const g = createGateway({
      baseUrl: 'http://x',
      transport: t,
      getToken: tokens('tok'),
    });
    await g.streamTurn({ message: 'hi' }, e => events.push(e));
    expect(events.map(e => e.type)).toEqual(['session', 'text', 'done']);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'http://x/assistant/turn',
    });
    expect(calls[0].headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(calls[0].body!)).toEqual({ message: 'hi' });
  });

  it('still works when the runtime cannot stream and hands over the body at the end', async () => {
    const events: StreamEvent[] = [];
    const { t } = transportOf(() => ({
      status: 200,
      body:
        line({ type: 'text', delta: 'A' }) +
        line({ type: 'done', outcome: 'ok', usage: {}, sources: [] }),
    }));
    await createGateway({
      baseUrl: 'http://x',
      transport: t,
      getToken: tokens('tok'),
    }).streamTurn({ message: 'hi' }, e => events.push(e));
    expect(events.map(e => e.type)).toEqual(['text', 'done']);
  });

  it('ignores events it does not know, so a newer server cannot break an older app', async () => {
    const events: StreamEvent[] = [];
    const { t } = transportOf(req => {
      req.onChunk?.(
        line({ type: 'telepathy', x: 1 }) + line({ type: 'text', delta: 'ok' }),
      );
      return { status: 200, body: '' };
    });
    await createGateway({
      baseUrl: 'http://x',
      transport: t,
      getToken: tokens('tok'),
    }).streamTurn({ message: 'hi' }, e => events.push(e));
    expect(events).toEqual([{ type: 'text', delta: 'ok' }]);
  });
});

describe('authentication', () => {
  it('refreshes the token once on a 401 and repeats the request', async () => {
    const getToken = tokens('old', 'new');
    const { t, calls } = transportOf((_r, n) =>
      n === 1
        ? { status: 401, body: '{"detail":{"code":"TOKEN_EXPIRED"}}' }
        : { status: 200, body: line({ type: 'text', delta: 'ok' }) },
    );
    const events: StreamEvent[] = [];
    await createGateway({
      baseUrl: 'http://x',
      transport: t,
      getToken,
    }).streamTurn({ message: 'hi' }, e => events.push(e));
    expect(calls.map(c => c.headers.Authorization)).toEqual([
      'Bearer old',
      'Bearer new',
    ]);
    expect(getToken).toHaveBeenLastCalledWith({ forceRefresh: true });
    expect(events).toHaveLength(1);
  });

  it('reports NO_SESSION when the refreshed token is still refused', async () => {
    const { t } = transportOf(() => ({ status: 401, body: '' }));
    await expect(
      createGateway({
        baseUrl: 'http://x',
        transport: t,
        getToken: tokens('a', 'b'),
      }).streamTurn({ message: 'hi' }, () => undefined),
    ).rejects.toMatchObject({ code: 'NO_SESSION' });
  });

  it('reports NO_SESSION without calling the server when nobody is signed in', async () => {
    const { t, calls } = transportOf(() => ({ status: 200, body: '' }));
    await expect(
      createGateway({
        baseUrl: 'http://x',
        transport: t,
        getToken: tokens(null),
      }).streamTurn({ message: 'hi' }, () => undefined),
    ).rejects.toMatchObject({ code: 'NO_SESSION' });
    expect(calls).toHaveLength(0);
  });

  it('reports OFFLINE when the token cannot be refreshed for lack of network', async () => {
    const getToken = jest.fn(async () => {
      throw new CloudError('NETWORK', 'down');
    });
    const { t } = transportOf(() => ({ status: 200, body: '' }));
    await expect(
      createGateway({ baseUrl: 'http://x', transport: t, getToken }).streamTurn(
        { message: 'hi' },
        () => undefined,
      ),
    ).rejects.toMatchObject({ code: 'OFFLINE' });
  });
});

describe('errors', () => {
  const failWith = async (
    status: number,
    detail: object | null,
    extra: { retryAfter?: number } = {},
  ) => {
    const { t } = transportOf(() => ({
      status,
      body: detail ? JSON.stringify({ detail }) : '',
      ...extra,
    }));
    try {
      await createGateway({
        baseUrl: 'http://x',
        transport: t,
        getToken: tokens('tok'),
      }).streamTurn({ message: 'hi' }, () => undefined);
    } catch (e) {
      return e as GatewayError;
    }
    throw new Error('expected the request to fail');
  };

  it.each([
    [503, { code: 'ASSISTANT_UNAVAILABLE', message: 'off' }, 'UNAVAILABLE'],
    [429, { code: 'RATE_LIMITED', message: 'slow' }, 'RATE_LIMITED'],
    [429, { code: 'DAILY_LIMIT', message: 'enough' }, 'DAILY_LIMIT'],
    [409, { code: 'TURN_IN_PROGRESS', message: 'wait' }, 'BUSY'],
    [404, { code: 'SESSION_NOT_FOUND', message: 'gone' }, 'SESSION_LOST'],
    [410, { code: 'TURN_EXPIRED', message: 'late' }, 'SESSION_LOST'],
    [409, { code: 'TURN_NOT_FOUND', message: 'none' }, 'SESSION_LOST'],
    [500, null, 'SERVER'],
    [422, { code: 'BAD_REQUEST', message: 'no' }, 'SERVER'],
  ])('%s %j becomes %s', async (status, detail, code) => {
    const err = await failWith(status, detail);
    expect(err).toBeInstanceOf(GatewayError);
    expect(err.code).toBe(code);
  });

  it('carries Retry-After', async () => {
    const err = await failWith(
      429,
      { code: 'RATE_LIMITED', message: 'x' },
      { retryAfter: 17 },
    );
    expect(err.retryAfter).toBe(17);
  });

  it('turns a network failure into OFFLINE', async () => {
    const g = createGateway({
      baseUrl: 'http://x',
      transport: async () => {
        throw new Error('network');
      },
      getToken: tokens('tok'),
    });
    await expect(
      g.streamTurn({ message: 'hi' }, () => undefined),
    ).rejects.toMatchObject({ code: 'OFFLINE' });
  });

  it('gives up when the server goes quiet', async () => {
    jest.useFakeTimers();
    const transport: Transport = req =>
      new Promise((_ok, reject) =>
        req.signal?.addEventListener('abort', () =>
          reject(new Error('aborted')),
        ),
      );
    const g = createGateway({
      baseUrl: 'http://x',
      transport,
      getToken: tokens('tok'),
      idleTimeoutMs: 5000,
    });
    const result = g
      .streamTurn({ message: 'hi' }, () => undefined)
      .catch(e => e);
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(5001);
    expect(await result).toMatchObject({ code: 'TIMEOUT' });
    jest.useRealTimers();
  });

  it('cancels when asked', async () => {
    const controller = new AbortController();
    const transport: Transport = req =>
      new Promise((_ok, reject) =>
        req.signal?.addEventListener('abort', () =>
          reject(new Error('aborted')),
        ),
      );
    const g = createGateway({
      baseUrl: 'http://x',
      transport,
      getToken: tokens('tok'),
    });
    const result = g
      .streamTurn({ message: 'hi' }, () => undefined, {
        signal: controller.signal,
      })
      .catch(e => e);
    await new Promise<void>(r => setImmediate(() => r()));
    controller.abort();
    expect(await result).toMatchObject({ code: 'CANCELLED' });
  });
});

describe('other calls', () => {
  it('reads the status and clears sessions', async () => {
    const { t, calls } = transportOf(req => ({
      status: 200,
      body:
        req.method === 'GET'
          ? '{"enabled":true,"provider":"anthropic","tools":["a"]}'
          : '{"deleted":1}',
    }));
    const g = createGateway({
      baseUrl: 'http://x',
      transport: t,
      getToken: tokens('tok'),
    });
    expect(await g.status()).toMatchObject({
      enabled: true,
      provider: 'anthropic',
    });
    await g.clearSession('a/b');
    await g.clearAll();
    expect(calls.map(c => `${c.method} ${c.url}`)).toEqual([
      'GET http://x/assistant/status',
      'DELETE http://x/assistant/sessions/a%2Fb',
      'DELETE http://x/assistant/sessions',
    ]);
  });
});
