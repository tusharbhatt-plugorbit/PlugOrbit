import React from 'react';
import {EmptyState, Screen} from '../../ui';

// PLACEHOLDER: replaced by the real "31 Roadside assistance" screen.
export default function RoadsideScreen(): React.JSX.Element {
  return (
    <Screen title="Roadside assistance">
      <EmptyState
        icon="bolt"
        title="Roadside assistance"
        body="This screen is being built."
      />
    </Screen>
  );
}
