import React from 'react';
import {EmptyState, Screen} from '../../ui';

// PLACEHOLDER: replaced by the real "14 Charging" screen.
export default function ActiveSessionScreen(): React.JSX.Element {
  return (
    <Screen title="Charging">
      <EmptyState
        icon="bolt"
        title="Charging"
        body="This screen is being built."
      />
    </Screen>
  );
}
