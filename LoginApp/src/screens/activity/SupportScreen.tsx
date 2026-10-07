import React from 'react';
import {EmptyState, Screen} from '../../ui';

// PLACEHOLDER: replaced by the real "22 Support center" screen.
export default function SupportScreen(): React.JSX.Element {
  return (
    <Screen title="Support center">
      <EmptyState
        icon="bolt"
        title="Support center"
        body="This screen is being built."
      />
    </Screen>
  );
}
