import React from 'react';
import {EmptyState, Screen} from '../../ui';

// PLACEHOLDER: replaced by the real "Your vehicles" screen.
export default function VehiclesScreen(): React.JSX.Element {
  return (
    <Screen title="Your vehicles">
      <EmptyState
        icon="bolt"
        title="Your vehicles"
        body="This screen is being built."
      />
    </Screen>
  );
}
