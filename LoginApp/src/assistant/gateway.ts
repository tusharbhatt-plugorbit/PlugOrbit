import { API_BASE_URL } from '../config/api';
import { CloudError } from '../services/backend';
import { getIdToken } from '../services/session';
import { NdjsonParser } from './ndjson';
import type { StreamEvent } from './types';

/**
 * The only code that talks to the AI gateway (Backend/app/ai). It carries the
 * signed-in user's ID token; there is no AI provider key anywhere in the app.
 */

export type GatewayErrorCode =
  | 'SERVER_CREDENTIALS'
  | 'NO_SESSION' // not signed in to the cloud, so the gateway cannot know who is asking
  | 'OFFLINE' // no usable answer: no network, unreachable
  | 'TIMEOUT' // the gateway went quiet
  | 'UNAVAILABLE' // the assistant is not configured or is switched off on the server
  | 'RATE_LIMITED'
  | 'DAILY_LIMIT'
  | 'BUSY' // the previous question is still being answered
  | 'SESSION_LOST' // the server forgot this conversation
  | 'CANCELLED'
  | 'SERVER';

export class GatewayError extends Error {
  code: GatewayErrorCode;
  status?: number;
  retryAfter?: number;

  constructor(
    code: GatewayErrorCode,
    message: string,
    extra: { status?: number; retryAfter?: number } = {},
  ) {
    super(message);
    this.name = 'GatewayError';
    this.code = code;
    this.status = extra.status;
    this.retryAfter = extra.retryAfter;
  }
}

/** What the transport reports back: the HTTP status and the headers that matter. */
export type TransportResult = {
  status: number;
  retryAfter?: number;
  body: string;
};

export type TransportRequest = {
  method: 'GET' | 'POST' | 'DELETE';
  url: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  /** New response text since the last call. May be called zero times (non-streaming runtimes). */
  onChunk?: (text: string) => void;
};

export type Transport = (req: TransportRequest) => Promise<TransportResult>;

/**
 * XMLHttpRequest rather than fetch: React Native's fetch hands over the body only
 * when it is complete, but its XHR delivers text as it arrives when `onprogress`
 * is set, which is what lets the first sentence be spoken while the rest is written.
 */
export const xhrTransport: Transport = req =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let seen = 0;
    const deliver = () => {
      const all = typeof xhr.responseText === 'string' ? xhr.responseText : '';
      if (all.length > seen) {
        const fresh = all.slice(seen);
        seen = all.length;
        req.onChunk?.(fresh);
      }
    };
    xhr.open(req.method, req.url);
    Object.entries(req.headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.onprogress = deliver;
    xhr.onload = () => {
      deliver();
      const retry = Number(xhr.getResponseHeader('Retry-After'));
      resolve({
        status: xhr.status,
        retryAfter: Number.isFinite(retry) && retry > 0 ? retry : undefined,
        body: xhr.responseText ?? '',
      });
    };
    xhr.onerror = () => reject(new Error('network'));
    xhr.ontimeout = () => reject(new Error('network'));
    xhr.onabort = () => reject(new Error('aborted'));
    req.signal?.addEventListener('abort', () => xhr.abort());
    if (req.signal?.aborted) {
      xhr.abort();
      return;
    }
    xhr.send(req.body);
  });

export type TurnBody = {
  session_id?: string;
  message?: string;
  turn_id?: string;
  tool_results?: unknown[];
  context?: unknown;
};

export type GatewayStatus = {
  enabled: boolean;
  reason?: string | null;
  provider: string;
  model?: string | null;
  tools: string[];
};

export type Gateway = {
  streamTurn: (
    body: TurnBody,
    onEvent: (event: StreamEvent) => void,
    options?: { signal?: AbortSignal },
  ) => Promise<void>;
  status: () => Promise<GatewayStatus>;
  clearSession: (sessionId: string) => Promise<void>;
  clearAll: () => Promise<void>;
};

export type GatewayDeps = {
  baseUrl?: string;
  transport?: Transport;
  getToken?: (opts?: { forceRefresh?: boolean }) => Promise<string | null>;
  /** The gateway sends nothing for this long: give up. */
  idleTimeoutMs?: number;
};

const KNOWN_EVENTS = new Set([
  'session',
  'text',
  'memory',
  'tool_requests',
  'actions',
  'done',
  'error',
]);

function errorFromResponse(res: TransportResult): GatewayError {
  let code = '';
  let message = '';
  try {
    const parsed = JSON.parse(res.body) as {
      detail?: { code?: string; message?: string };
    };
    code = parsed.detail?.code ?? '';
    message = parsed.detail?.message ?? '';
  } catch {
    // not JSON
  }
  const extra = { status: res.status, retryAfter: res.retryAfter };
  if (code === 'SERVER_CREDENTIALS_EXPIRED') {
    return new GatewayError('SERVER_CREDENTIALS', message, extra);
  }
  if (res.status === 401 || res.status === 403) {
    return new GatewayError('NO_SESSION', 'You need to be signed in.', extra);
  }
  if (res.status === 503 || code === 'ASSISTANT_UNAVAILABLE') {
    return new GatewayError(
      'UNAVAILABLE',
      message || 'The assistant isn’t available right now.',
      extra,
    );
  }
  if (code === 'DAILY_LIMIT') {
    return new GatewayError('DAILY_LIMIT', message, extra);
  }
  if (res.status === 429) {
    return new GatewayError('RATE_LIMITED', message, extra);
  }
  if (res.status === 409 && code === 'TURN_IN_PROGRESS') {
    return new GatewayError('BUSY', message, extra);
  }
  if (
    res.status === 404 ||
    res.status === 410 ||
    code === 'TURN_NOT_FOUND' ||
    code === 'SESSION_NOT_FOUND'
  ) {
    return new GatewayError('SESSION_LOST', message, extra);
  }
  return new GatewayError(
    'SERVER',
    message || 'The assistant had a problem.',
    extra,
  );
}

export function createGateway(deps: GatewayDeps = {}): Gateway {
  const baseUrl = deps.baseUrl ?? API_BASE_URL;
  const transport = deps.transport ?? xhrTransport;
  const getToken = deps.getToken ?? getIdToken;
  const idleMs = deps.idleTimeoutMs ?? 30_000;

  async function token(forceRefresh = false): Promise<string> {
    try {
      const t = await getToken({ forceRefresh });
      if (t) {
        return t;
      }
    } catch (e) {
      if (e instanceof CloudError && e.code === 'NETWORK') {
        throw new GatewayError('OFFLINE', 'No connection.');
      }
    }
    throw new GatewayError('NO_SESSION', 'You need to be signed in.');
  }

  /** One request with auth; on a 401 the token is refreshed once and the call repeated. */
  async function send(
    req: Omit<TransportRequest, 'headers'> & {
      headers?: Record<string, string>;
    },
  ): Promise<TransportResult> {
    const attempt = async (forceRefresh: boolean) => {
      const bearer = await token(forceRefresh);
      return transport({
        ...req,
        url: `${baseUrl}${req.url}`,
        headers: {
          Accept: 'application/json',
          ...(req.body !== undefined
            ? { 'Content-Type': 'application/json' }
            : {}),
          ...req.headers,
          Authorization: `Bearer ${bearer}`,
        },
      });
    };
    try {
      let res = await attempt(false);
      if (res.status === 401) {
        res = await attempt(true);
      }
      return res;
    } catch (e) {
      if (e instanceof GatewayError) {
        throw e;
      }
      if (req.signal?.aborted) {
        throw new GatewayError('CANCELLED', 'Cancelled.');
      }
      throw new GatewayError('OFFLINE', 'No connection.');
    }
  }

  async function json<T>(req: Parameters<typeof send>[0]): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let res: TransportResult;
    try {
      res = await Promise.race([
        send({ ...req, signal: controller.signal }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(new GatewayError('TIMEOUT', 'The assistant took too long.'));
            controller.abort();
          }, idleMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (res.status < 200 || res.status >= 300) {
      throw errorFromResponse(res);
    }
    try {
      return JSON.parse(res.body) as T;
    } catch {
      throw new GatewayError(
        'SERVER',
        'The assistant sent an unreadable answer.',
      );
    }
  }

  return {
    async streamTurn(body, onEvent, options = {}) {
      const parser = new NdjsonParser();
      const controller = new AbortController();
      let idle: ReturnType<typeof setTimeout> | null = null;
      let timedOut = false;
      let streamed = false;
      const arm = () => {
        if (idle) {
          clearTimeout(idle);
        }
        idle = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, idleMs);
      };
      const relay = () => controller.abort();
      options.signal?.addEventListener('abort', relay);
      if (options.signal?.aborted) {
        throw new GatewayError('CANCELLED', 'Cancelled.');
      }
      const emit = (items: unknown[]) =>
        items.forEach(item => {
          const type = (item as { type?: unknown } | null)?.type;
          if (typeof type === 'string' && KNOWN_EVENTS.has(type)) {
            onEvent(item as StreamEvent);
          }
        });
      arm();
      try {
        const res = await send({
          method: 'POST',
          url: '/orbit-assist/turn',
          body: JSON.stringify(body),
          signal: controller.signal,
          onChunk: text => {
            streamed = true;
            arm();
            emit(parser.push(text));
          },
        });
        if (res.status < 200 || res.status >= 300) {
          throw errorFromResponse(res);
        }
        // A runtime that cannot stream hands everything over at the end.
        if (!streamed) {
          emit(parser.push(res.body));
        }
        emit(parser.flush());
      } catch (e) {
        if (timedOut) {
          throw new GatewayError('TIMEOUT', 'The assistant took too long.');
        }
        throw e;
      } finally {
        if (idle) {
          clearTimeout(idle);
        }
        options.signal?.removeEventListener('abort', relay);
      }
    },

    status: () =>
      json<GatewayStatus>({ method: 'GET', url: '/orbit-assist/status' }),

    async clearSession(sessionId) {
      await json({
        method: 'DELETE',
        url: `/orbit-assist/sessions/${encodeURIComponent(sessionId)}`,
      });
    },

    async clearAll() {
      await json({ method: 'DELETE', url: '/orbit-assist/sessions' });
    },
  };
}
