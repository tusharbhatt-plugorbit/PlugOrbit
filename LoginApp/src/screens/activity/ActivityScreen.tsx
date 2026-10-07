import React from 'react';
import {EmptyState, Screen} from '../../ui';

// PLACEHOLDER: replaced by the real "18 Activity" screen.
export default function ActivityScreen(): React.JSX.Element {
  return (
    <Screen title="Activity">
      <EmptyState
        icon="bolt"
        title="Activity"
        body="This screen is being built."
      />
    </Screen>
  );
}
