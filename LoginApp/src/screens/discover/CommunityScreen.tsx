import React from 'react';
import {EmptyState, Screen} from '../../ui';

// PLACEHOLDER: replaced by the real "36 Community updates" screen.
export default function CommunityScreen(): React.JSX.Element {
  return (
    <Screen title="Community updates">
      <EmptyState
        icon="bolt"
        title="Community updates"
        body="This screen is being built."
      />
    </Screen>
  );
}
