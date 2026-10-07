import React from 'react';
import {EmptyState, Screen} from '../../ui';

// PLACEHOLDER: replaced by the real "04 Nearby chargers" screen.
export default function StationListScreen(): React.JSX.Element {
  return (
    <Screen title="Nearby chargers">
      <EmptyState
        icon="bolt"
        title="Nearby chargers"
        body="This screen is being built."
      />
    </Screen>
  );
}
