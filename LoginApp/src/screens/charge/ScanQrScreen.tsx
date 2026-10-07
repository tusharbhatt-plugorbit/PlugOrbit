import React from 'react';
import {EmptyState, Screen} from '../../ui';

// PLACEHOLDER: replaced by the real "12 Scan QR" screen.
export default function ScanQrScreen(): React.JSX.Element {
  return (
    <Screen title="Scan QR">
      <EmptyState
        icon="bolt"
        title="Scan QR"
        body="This screen is being built."
      />
    </Screen>
  );
}
