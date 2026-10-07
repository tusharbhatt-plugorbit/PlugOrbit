import React from 'react';
import {EmptyState, Screen} from '../../ui';

// PLACEHOLDER: replaced by the real "02 Current battery" screen.
export default function ManualSocScreen(): React.JSX.Element {
  return (
    <Screen title="Current battery">
      <EmptyState
        icon="bolt"
        title="Current battery"
        body="This screen is being built."
      />
    </Screen>
  );
}
