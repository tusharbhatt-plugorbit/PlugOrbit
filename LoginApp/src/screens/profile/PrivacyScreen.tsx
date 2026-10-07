import React from 'react';
import {EmptyState, Screen} from '../../ui';

// PLACEHOLDER: replaced by the real "40 Privacy & data" screen.
export default function PrivacyScreen(): React.JSX.Element {
  return (
    <Screen title="Privacy & data">
      <EmptyState
        icon="bolt"
        title="Privacy & data"
        body="This screen is being built."
      />
    </Screen>
  );
}
