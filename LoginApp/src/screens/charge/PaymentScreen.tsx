import React from 'react';
import {EmptyState, Screen} from '../../ui';

// PLACEHOLDER: replaced by the real "15 Payment" screen.
export default function PaymentScreen(): React.JSX.Element {
  return (
    <Screen title="Payment">
      <EmptyState
        icon="bolt"
        title="Payment"
        body="This screen is being built."
      />
    </Screen>
  );
}
