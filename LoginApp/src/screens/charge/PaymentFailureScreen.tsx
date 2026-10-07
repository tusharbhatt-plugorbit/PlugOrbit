import React from 'react';
import {EmptyState, Screen} from '../../ui';

// PLACEHOLDER: replaced by the real "16 Payment issue" screen.
export default function PaymentFailureScreen(): React.JSX.Element {
  return (
    <Screen title="Payment issue">
      <EmptyState
        icon="bolt"
        title="Payment issue"
        body="This screen is being built."
      />
    </Screen>
  );
}
