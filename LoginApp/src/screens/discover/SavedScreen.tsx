import React from 'react';
import {EmptyState, Screen} from '../../ui';

// PLACEHOLDER: replaced by the real "25 Saved" screen.
export default function SavedScreen(): React.JSX.Element {
  return (
    <Screen title="Saved">
      <EmptyState
        icon="bolt"
        title="Saved"
        body="This screen is being built."
      />
    </Screen>
  );
}
