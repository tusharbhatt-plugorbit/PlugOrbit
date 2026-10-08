import React, {useEffect, useMemo, useRef} from 'react';
import {AppState as RNAppState} from 'react-native';
import {AppNavigator} from '../navigation/AppNavigator';
import type {Navigation} from '../navigation/NavigationContext';
import {REGISTRY} from '../navigation/registry';
import {useServices} from '../services';
import {appStore, flushAppStore, useApp} from '../store/appStore';
import {TabBar, ToastHost, showToast} from '../ui';
import {BootPlan, planBoot} from './initialStack';
import {SessionBanner} from './SessionBanner';

type Props = {
  /** Test/preview hook to start somewhere specific. */
  bootOverride?: BootPlan;
};

/** The signed-in app: tabs + stack, with onboarding and session recovery. */
export default function MainApp({bootOverride}: Props): React.JSX.Element {
  const {session} = useServices();
  // Computed once, from the state hydrated before this mounts.
  const boot = useMemo(
    () => bootOverride ?? planBoot(appStore.get()),
    [bootOverride],
  );
  const navRef = useRef<Navigation | null>(null);
  const hasSession = useApp(s => s.session !== null);
  const unread = useApp(s => s.notifications.some(n => !n.read));

  useEffect(() => {
    if (boot.cancelPendingSession) {
      session.cancelPending();
    }
    if (boot.toast) {
      showToast(boot.toast.message, boot.toast.tone, 4500);
    }
  }, [boot, session]);

  // Make sure the latest state is on disk when the app goes to the background.
  useEffect(() => {
    const sub = RNAppState.addEventListener('change', next => {
      if (next !== 'active') {
        flushAppStore();
      }
    });
    return () => sub.remove();
  }, []);

  return (
    <AppNavigator
      registry={REGISTRY}
      initialTab={boot.tab}
      initialStack={boot.stack}
      navigationRef={navRef}
      renderTabBar={({tab, onSelect}) => (
        <TabBar
          tab={tab}
          onSelect={onSelect}
          badges={{Charge: hasSession, Home: unread}}
        />
      )}
      overlay={
        <>
          <SessionBanner />
          <ToastHost />
        </>
      }
    />
  );
}
