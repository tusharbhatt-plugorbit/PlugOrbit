import React from 'react';
import type {Resource} from './useResource';
import {ErrorState, ListSkeleton, Notice, OfflineState} from './States';

type Props<T> = {
  resource: Resource<T>;
  render: (data: T) => React.ReactNode;
  /** Return true to show `empty` instead of `render`. */
  isEmpty?: (data: T) => boolean;
  empty?: React.ReactNode;
  loading?: React.ReactNode;
  errorTitle?: string;
  errorBody?: string;
};

/**
 * Renders the right thing for every resource state, keeping stale data visible
 * (with a notice) when a refresh fails or the connection drops.
 */
export function AsyncView<T>({
  resource,
  render,
  isEmpty,
  empty,
  loading,
  errorTitle,
  errorBody,
}: Props<T>) {
  const {status, data, reload} = resource;

  if (status === 'loading' && data === null) {
    return <>{loading ?? <ListSkeleton />}</>;
  }
  if (data === null) {
    return status === 'offline' ? (
      <OfflineState onRetry={reload} />
    ) : (
      <ErrorState title={errorTitle} body={errorBody} onRetry={reload} />
    );
  }
  const stale =
    status === 'offline' ? (
      <Notice
        tone="warn"
        title="Showing saved results"
        body="You’re offline, so this may be out of date."
      />
    ) : status === 'error' ? (
      <Notice
        tone="danger"
        title="Couldn’t refresh"
        body="Showing the last results we have."
      />
    ) : null;
  return (
    <>
      {stale}
      {isEmpty?.(data) ? empty ?? null : render(data)}
    </>
  );
}
