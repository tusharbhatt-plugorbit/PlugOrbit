import React from 'react';
import {EmptyState, Screen} from '../../ui';

// PLACEHOLDER: replaced by the real "29 Charging alerts" screen.
export default function AlertsScreen(): React.JSX.Element {
  return (
    <Screen title="Charging alerts">
      <EmptyState
        icon="bolt"
        title="Charging alerts"
        body="This screen is being built."
      />
    </Screen>
  );
}
