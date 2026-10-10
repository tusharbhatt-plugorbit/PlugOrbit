import React, {
  ComponentType,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import {Animated, BackHandler, Easing, StyleSheet, View} from 'react-native';
import {colors} from '../theme';
import {useKeyboardVisible} from '../ui/useKeyboardVisible';
import {
  EntryContext,
  Navigation,
  NavigationContext,
  NavigationState,
  NavigationStateContext,
} from './NavigationContext';
import {NavArgs, RouteName, TabName, isTab} from './params';

export type RouteEntry = {
  key: string;
  name: RouteName;
  params: unknown;
};

export type RouteConfig = {
  component: ComponentType;
  /** Show the bottom tab bar on this screen (tab roots always do). */
  tabBar?: boolean;
  /** Which tab to highlight while this screen is on top (default: the current tab). */
  tab?: TabName;
};

export type Registry = Record<RouteName, RouteConfig>;

type State = {
  tab: TabName;
  /** Tabs that have been opened, kept mounted so they keep their state. */
  visited: TabName[];
  stack: RouteEntry[];
  /** A popped screen that is still animating out. */
  leaving: RouteEntry | null;
  counter: number;
};

type Action =
  | {type: 'push'; name: RouteName; params: unknown}
  | {type: 'replace'; name: RouteName; params: unknown}
  | {type: 'pop'}
  | {type: 'popToTop'}
  | {type: 'popTo'; name: RouteName}
  | {type: 'reset'; name: RouteName; params: unknown}
  | {type: 'tab'; tab: TabName}
  | {type: 'doneLeaving'; key: string};

function entry(
  state: State,
  name: RouteName,
  params: unknown,
): [RouteEntry, number] {
  const counter = state.counter + 1;
  return [{key: `${name}-${counter}`, name, params}, counter];
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'push': {
      if (isTab(action.name)) {
        return reducer(state, {type: 'tab', tab: action.name});
      }
      const top = state.stack[state.stack.length - 1];
      // Ignore accidental double-taps that would push the same screen twice.
      if (
        top &&
        top.name === action.name &&
        JSON.stringify(top.params) === JSON.stringify(action.params)
      ) {
        return state;
      }
      const [e, counter] = entry(state, action.name, action.params);
      return {...state, stack: [...state.stack, e], counter, leaving: null};
    }
    case 'replace': {
      if (isTab(action.name)) {
        return reducer(state, {type: 'tab', tab: action.name});
      }
      const [e, counter] = entry(state, action.name, action.params);
      const stack = state.stack.length ? [...state.stack.slice(0, -1), e] : [e];
      return {...state, stack, counter, leaving: null};
    }
    case 'pop': {
      if (state.stack.length === 0) {
        return state;
      }
      const leaving = state.stack[state.stack.length - 1];
      return {...state, stack: state.stack.slice(0, -1), leaving};
    }
    case 'popToTop': {
      if (state.stack.length === 0) {
        return state;
      }
      return {...state, stack: [], leaving: null};
    }
    case 'popTo': {
      let idx = -1;
      for (let i = state.stack.length - 2; i >= 0; i--) {
        if (state.stack[i].name === action.name) {
          idx = i;
          break;
        }
      }
      if (idx < 0) {
        return state;
      }
      return {...state, stack: state.stack.slice(0, idx + 1), leaving: null};
    }
    case 'reset': {
      if (isTab(action.name)) {
        return {
          ...state,
          tab: action.name,
          visited: state.visited.includes(action.name)
            ? state.visited
            : [...state.visited, action.name],
          stack: [],
          leaving: null,
        };
      }
      const [e, counter] = entry(state, action.name, action.params);
      return {...state, stack: [e], counter, leaving: null};
    }
    case 'tab':
      return {
        ...state,
        tab: action.tab,
        visited: state.visited.includes(action.tab)
          ? state.visited
          : [...state.visited, action.tab],
        stack: [],
        leaving: null,
      };
    case 'doneLeaving':
      return state.leaving?.key === action.key
        ? {...state, leaving: null}
        : state;
    default:
      return state;
  }
}

type Props = {
  registry: Registry;
  initialTab?: TabName;
  initialStack?: ReadonlyArray<{name: RouteName; params?: unknown}>;
  /** Rendered over the active screen when the route asks for it. */
  renderTabBar: (props: {
    tab: TabName;
    onSelect: (tab: TabName) => void;
  }) => React.ReactNode;
  /** Optional layer above everything (toasts, offline banner, sheets). */
  overlay?: React.ReactNode;
  /** Receives the imperative API once, for non-React callers (deep links, recovery). */
  navigationRef?: React.MutableRefObject<Navigation | null>;
};

const DURATION = 240;

function Host({
  entryValue,
  config,
  animateIn,
  leaving,
  onLeft,
  hidden,
}: {
  entryValue: RouteEntry & {focused: boolean};
  config: RouteConfig;
  animateIn: boolean;
  leaving: boolean;
  onLeft: () => void;
  hidden: boolean;
}) {
  const progress = useRef(new Animated.Value(animateIn ? 0 : 1)).current;

  useEffect(() => {
    if (animateIn) {
      Animated.timing(progress, {
        toValue: 1,
        duration: DURATION,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [animateIn, progress]);

  useEffect(() => {
    if (leaving) {
      Animated.timing(progress, {
        toValue: 0,
        duration: DURATION - 40,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({finished}) => finished && onLeft());
    }
  }, [leaving, progress, onLeft]);

  const Component = config.component;
  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        styles.host,
        hidden && styles.hidden,
        {
          opacity: progress,
          transform: [
            {
              translateX: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [28, 0],
              }),
            },
          ],
        },
      ]}
      testID={`screen-${entryValue.key}`}
      pointerEvents={entryValue.focused ? 'auto' : 'none'}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}>
      <EntryContext.Provider
        value={{
          key: entryValue.key,
          name: entryValue.name,
          params: entryValue.params,
          focused: entryValue.focused && !leaving,
        }}>
        <Component />
      </EntryContext.Provider>
    </Animated.View>
  );
}

export function AppNavigator({
  registry,
  initialTab = 'Home',
  initialStack = [],
  renderTabBar,
  overlay,
  navigationRef,
}: Props): React.JSX.Element {
  const keyboardVisible = useKeyboardVisible();
  const [state, dispatch] = useReducer(reducer, undefined, (): State => {
    const stack = initialStack.map((e, i) => ({
      key: `${e.name}-${i + 1}`,
      name: e.name,
      params: e.params,
    }));
    return {
      tab: initialTab,
      visited: [initialTab],
      stack,
      leaving: null,
      counter: stack.length,
    };
  });

  // Latest state for imperative callers, without re-creating the API.
  const stateRef = useRef(state);
  stateRef.current = state;

  const navigation = useMemo<Navigation>(
    () => ({
      navigate: (name, ...args) =>
        dispatch({type: 'push', name, params: args[0]}),
      replace: (name, ...args) =>
        dispatch({type: 'replace', name, params: args[0]}),
      goBack: () => dispatch({type: 'pop'}),
      canGoBack: () => stateRef.current.stack.length > 0,
      popToTop: () => dispatch({type: 'popToTop'}),
      reset: (name, ...args) =>
        dispatch({type: 'reset', name, params: args[0]}),
      popTo: name => {
        const s = stateRef.current;
        const found = s.stack.slice(0, -1).some(e => e.name === name);
        if (found) {
          dispatch({type: 'popTo', name});
        }
        return found;
      },
      switchTab: tab => dispatch({type: 'tab', tab}),
    }),
    [],
  );

  useEffect(() => {
    if (navigationRef) {
      navigationRef.current = navigation;
    }
  }, [navigation, navigationRef]);

  // Android hardware back: pop, then fall back to Home, then let the OS exit.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const s = stateRef.current;
      if (s.stack.length > 0) {
        dispatch({type: 'pop'});
        return true;
      }
      if (s.tab !== 'Home') {
        dispatch({type: 'tab', tab: 'Home'});
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, []);

  const top = state.stack[state.stack.length - 1];
  const visibleName: RouteName = top ? top.name : state.tab;
  const navState = useMemo<NavigationState>(
    () => ({tab: state.tab, current: visibleName, depth: state.stack.length}),
    [state.tab, visibleName, state.stack.length],
  );

  const showTabBar = top ? !!registry[top.name]?.tabBar : true;

  const onLeft = useCallback(
    (key: string) => dispatch({type: 'doneLeaving', key}),
    [],
  );

  const stackHidden = state.stack.length > 0;
  const seen = useRef(new Set<string>());

  return (
    <NavigationContext.Provider value={navigation}>
      <NavigationStateContext.Provider value={navState}>
        <View style={styles.root}>
          <View style={styles.screens}>
            {state.visited.map(tab => {
              const focused = !stackHidden && tab === state.tab;
              return (
                <Host
                  key={`tab-${tab}`}
                  entryValue={{
                    key: `tab-${tab}`,
                    name: tab,
                    params: undefined,
                    focused,
                  }}
                  config={registry[tab]}
                  animateIn={false}
                  leaving={false}
                  onLeft={noop}
                  hidden={tab !== state.tab || stackHidden}
                />
              );
            })}
            {state.stack.map((e, i) => {
              const isTop = i === state.stack.length - 1;
              const animateIn = !seen.current.has(e.key);
              seen.current.add(e.key);
              return (
                <Host
                  key={e.key}
                  entryValue={{...e, focused: isTop}}
                  config={registry[e.name]}
                  animateIn={animateIn}
                  leaving={false}
                  onLeft={noop}
                  hidden={!isTop}
                />
              );
            })}
            {state.leaving && (
              <Host
                key={`${state.leaving.key}-leaving`}
                entryValue={{...state.leaving, focused: false}}
                config={registry[state.leaving.name]}
                animateIn={false}
                leaving
                onLeft={() => onLeft(state.leaving!.key)}
                hidden={false}
              />
            )}
          </View>
          {showTabBar &&
            !keyboardVisible &&
            renderTabBar({
              tab: (top && registry[top.name]?.tab) || state.tab,
              onSelect: tab => dispatch({type: 'tab', tab}),
            })}
          {overlay}
        </View>
      </NavigationStateContext.Provider>
    </NavigationContext.Provider>
  );
}

function noop() {}

export type {NavArgs};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.bg},
  screens: {flex: 1},
  host: {backgroundColor: colors.bg},
  hidden: {display: 'none'},
});
