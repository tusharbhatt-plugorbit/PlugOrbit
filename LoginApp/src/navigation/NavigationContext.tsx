import {createContext, useContext} from 'react';
import type {NavArgs, RouteName, RouteParams, TabName} from './params';

export type Navigation = {
  /** Push a screen. Tab names switch tab instead. */
  navigate: <K extends RouteName>(name: K, ...args: NavArgs<K>) => void;
  /** Replace the current screen (no back entry for the old one). */
  replace: <K extends RouteName>(name: K, ...args: NavArgs<K>) => void;
  goBack: () => void;
  canGoBack: () => boolean;
  /** Pop to the tab root. */
  popToTop: () => void;
  /** Drop the whole stack and start from one screen. */
  reset: <K extends RouteName>(name: K, ...args: NavArgs<K>) => void;
  /** Go back to the nearest earlier entry with this name, if any. */
  popTo: (name: RouteName) => boolean;
  switchTab: (tab: TabName) => void;
};

export type NavigationState = {
  tab: TabName;
  /** Name of the visible screen. */
  current: RouteName;
  depth: number;
};

export const NavigationContext = createContext<Navigation | null>(null);
export const NavigationStateContext = createContext<NavigationState | null>(
  null,
);

type EntryValue = {
  key: string;
  name: RouteName;
  params: unknown;
  focused: boolean;
};
export const EntryContext = createContext<EntryValue | null>(null);

export function useNavigation(): Navigation {
  const nav = useContext(NavigationContext);
  if (!nav) {
    throw new Error('useNavigation must be used inside <AppNavigator>');
  }
  return nav;
}

export function useNavigationState(): NavigationState {
  const s = useContext(NavigationStateContext);
  if (!s) {
    throw new Error('useNavigationState must be used inside <AppNavigator>');
  }
  return s;
}

export function useRoute<K extends RouteName>(): {
  key: string;
  name: K;
  params: RouteParams[K];
} {
  const e = useContext(EntryContext);
  if (!e) {
    throw new Error('useRoute must be used inside a screen');
  }
  return {key: e.key, name: e.name as K, params: e.params as RouteParams[K]};
}

/**
 * True while this screen is the visible one. Hidden (kept-alive) screens should
 * pause timers and polling.
 */
export function useIsFocused(): boolean {
  const e = useContext(EntryContext);
  return e ? e.focused : true;
}
