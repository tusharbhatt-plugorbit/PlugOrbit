import React from 'react';
import {EmptyState, Screen} from '../../ui';

// PLACEHOLDER: replaced by the real "24 Profile" screen.
export default function ProfileScreen(): React.JSX.Element {
  return (
    <Screen title="Profile">
      <EmptyState
        icon="bolt"
        title="Profile"
        body="This screen is being built."
      />
    </Screen>
  );
}
