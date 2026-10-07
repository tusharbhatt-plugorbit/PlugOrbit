import React from 'react';
import {EmptyState, Screen} from '../../ui';

// PLACEHOLDER: replaced by the real "Payment methods" screen.
export default function PaymentMethodsScreen(): React.JSX.Element {
  return (
    <Screen title="Payment methods">
      <EmptyState
        icon="bolt"
        title="Payment methods"
        body="This screen is being built."
      />
    </Screen>
  );
}
