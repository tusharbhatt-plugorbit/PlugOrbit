import React from 'react';
import {EmptyState, Screen} from '../../ui';

// PLACEHOLDER: replaced by the real "33 Availability forecast" screen.
export default function ForecastScreen(): React.JSX.Element {
  return (
    <Screen title="Availability forecast">
      <EmptyState
        icon="bolt"
        title="Availability forecast"
        body="This screen is being built."
      />
    </Screen>
  );
}
