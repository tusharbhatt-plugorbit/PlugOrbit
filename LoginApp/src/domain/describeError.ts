// Turns a thrown service error into words a driver can act on. Dispatches on the
// error's `name` (set by each error class) so the domain layer stays free of
// service imports and works for errors created by any backend adapter.

export type ErrorKind =
  | 'offline'
  | 'api'
  | 'integration'
  | 'payment'
  | 'connector'
  | 'unknown';

export type ErrorCopy = {
  kind: ErrorKind;
  title: string;
  body: string;
};

const KIND_BY_NAME: Record<string, ErrorKind> = {
  OfflineError: 'offline',
  ApiError: 'api',
  IntegrationUnavailableError: 'integration',
  PaymentRequiredError: 'payment',
  ConnectorUnavailableError: 'connector',
};

/**
 * @param fallback what could not be done, e.g. "We couldn't save your vehicle."
 */
export function describeError(e: unknown, fallback: string): ErrorCopy {
  const name = e instanceof Error ? e.name : '';
  const message = e instanceof Error ? e.message : '';
  const kind = KIND_BY_NAME[name] ?? 'unknown';
  switch (kind) {
    case 'offline':
      return {
        kind,
        title: 'You’re offline',
        body: `${fallback} Reconnect and try again. Nothing was changed.`,
      };
    case 'api':
      return {
        kind,
        title: 'Something went wrong on our side',
        body: `${fallback} ${message || 'Try again in a moment.'}`.trim(),
      };
    case 'integration':
      return {
        kind,
        title: 'Not available for this charger',
        body: message || fallback,
      };
    case 'payment':
      return {kind, title: 'Payment needs attention', body: message || fallback};
    case 'connector':
      return {kind, title: 'Charger not available', body: message || fallback};
    default:
      return {kind, title: 'Something went wrong', body: fallback};
  }
}

/** Notice tone for an error: offline is a warning, everything else an error. */
export function errorTone(copy: ErrorCopy): 'warn' | 'danger' {
  return copy.kind === 'offline' ? 'warn' : 'danger';
}
