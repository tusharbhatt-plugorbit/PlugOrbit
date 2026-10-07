import React from 'react';
import {EmptyState, Screen} from '../../ui';

// PLACEHOLDER: replaced by the real "13 Start charging" screen.
export default function StartChargingScreen(): React.JSX.Element {
  return (
    <Screen title="Start charging">
      <EmptyState
        icon="bolt"
        title="Start charging"
        body="This screen is being built."
      />
    </Screen>
  );
}
