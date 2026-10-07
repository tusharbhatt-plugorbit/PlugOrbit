import React from 'react';
import {EmptyState, Screen} from '../../ui';

// PLACEHOLDER: replaced by the real "34 Charging cost" screen.
export default function CostCalculatorScreen(): React.JSX.Element {
  return (
    <Screen title="Charging cost">
      <EmptyState
        icon="bolt"
        title="Charging cost"
        body="This screen is being built."
      />
    </Screen>
  );
}
