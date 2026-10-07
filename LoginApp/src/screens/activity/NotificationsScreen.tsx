import React from 'react';
import {EmptyState, Screen} from '../../ui';

// PLACEHOLDER: replaced by the real "37 Notifications" screen.
export default function NotificationsScreen(): React.JSX.Element {
  return (
    <Screen title="Notifications">
      <EmptyState
        icon="bolt"
        title="Notifications"
        body="This screen is being built."
      />
    </Screen>
  );
}
