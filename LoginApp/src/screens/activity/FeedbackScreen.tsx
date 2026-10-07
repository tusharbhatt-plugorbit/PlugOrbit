import React from 'react';
import {EmptyState, Screen} from '../../ui';

// PLACEHOLDER: replaced by the real "20 Feedback" screen.
export default function FeedbackScreen(): React.JSX.Element {
  return (
    <Screen title="Feedback">
      <EmptyState
        icon="bolt"
        title="Feedback"
        body="This screen is being built."
      />
    </Screen>
  );
}
