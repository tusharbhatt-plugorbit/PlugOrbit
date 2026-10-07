import React from 'react';
import {EmptyState, Screen} from '../../ui';

// PLACEHOLDER: replaced by the real "17 Receipt" screen.
export default function ReceiptScreen(): React.JSX.Element {
  return (
    <Screen title="Receipt">
      <EmptyState
        icon="bolt"
        title="Receipt"
        body="This screen is being built."
      />
    </Screen>
  );
}
