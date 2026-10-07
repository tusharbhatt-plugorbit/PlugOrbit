import React from 'react';
import {EmptyState, Screen} from '../../ui';

// PLACEHOLDER: replaced by the real "27 Queue status" screen.
export default function QueueScreen(): React.JSX.Element {
  return (
    <Screen title="Queue status">
      <EmptyState
        icon="bolt"
        title="Queue status"
        body="This screen is being built."
      />
    </Screen>
  );
}
