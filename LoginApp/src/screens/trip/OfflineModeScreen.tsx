import React from 'react';
import {EmptyState, Screen} from '../../ui';

// PLACEHOLDER: replaced by the real "35 Offline trip mode" screen.
export default function OfflineModeScreen(): React.JSX.Element {
  return (
    <Screen title="Offline trip mode">
      <EmptyState
        icon="bolt"
        title="Offline trip mode"
        body="This screen is being built."
      />
    </Screen>
  );
}
