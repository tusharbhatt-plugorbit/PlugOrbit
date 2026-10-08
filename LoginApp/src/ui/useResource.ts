import {useCallback, useEffect, useRef, useState} from 'react';
import {OfflineError} from '../services/types';

export type ResourceStatus = 'loading' | 'ready' | 'error' | 'offline';

export type Resource<T> = {
  status: ResourceStatus;
  data: T | null;
  error: Error | null;
  /** Reload without blanking the screen (pull to refresh). */
  refreshing: boolean;
  reload: () => void;
};

/**
 * Loads async data with the states every screen must handle: loading, ready,
 * error and offline. Keeps the last good data visible while a reload runs, and
 * ignores results from superseded requests.
 */
export function useResource<T>(
  loader: () => Promise<T>,
  deps: ReadonlyArray<unknown>,
  options: {enabled?: boolean} = {},
): Resource<T> {
  const {enabled = true} = options;
  const [state, setState] = useState<{
    status: ResourceStatus;
    data: T | null;
    error: Error | null;
    refreshing: boolean;
  }>({status: 'loading', data: null, error: null, refreshing: false});
  const requestId = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const run = useCallback((soft: boolean) => {
    const id = ++requestId.current;
    setState(s =>
      soft && s.data !== null
        ? {...s, refreshing: true}
        : {status: 'loading', data: s.data, error: null, refreshing: false},
    );
    loaderRef.current().then(
      data => {
        if (id === requestId.current) {
          setState({status: 'ready', data, error: null, refreshing: false});
        }
      },
      (e: unknown) => {
        if (id !== requestId.current) {
          return;
        }
        const error = e instanceof Error ? e : new Error(String(e));
        setState(s => ({
          status: error instanceof OfflineError ? 'offline' : 'error',
          data: s.data,
          error,
          refreshing: false,
        }));
      },
    );
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    run(false);
    const counter = requestId;
    return () => {
      // Drop the result of any request still in flight for the old deps.
      counter.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  const reload = useCallback(() => run(true), [run]);
  return {...state, reload};
}
