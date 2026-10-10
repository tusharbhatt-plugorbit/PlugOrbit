/* eslint-env jest */
// react-native-safe-area-context waits for native inset data before rendering
// children, which never arrives under Jest. Use the library's official mock.
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

// Native map: render children (markers) as plain views so tests can find and
// press them, and stub the imperative API the screen uses.
jest.mock('react-native-maps', () => {
  const React = require('react');
  const {View} = require('react-native');
  const MapView = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({animateToRegion: jest.fn()}));
    // A healthy native map reports ready right after it mounts.
    React.useEffect(() => {
      global.__MAP_MOUNTS = (global.__MAP_MOUNTS || 0) + 1;
      // Tests set global.__MAP_NEVER_READY to simulate a map that cannot start.
      if (props.onMapReady && !global.__MAP_NEVER_READY) {
        props.onMapReady();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return React.createElement(View, {testID: 'map', ...props}, props.children);
  });
  const Marker = props => React.createElement(View, props, props.children);
  const Polyline = props =>
    React.createElement(View, {testID: 'route', ...props});
  return {
    __esModule: true,
    default: MapView,
    Marker,
    Polyline,
    PROVIDER_GOOGLE: 'google',
  };
});

// Fallback map (Android without a Google key): a WebView we cannot run here.
// It renders as a plain view, records what the app injects into the page, and
// tests call its onMessage to play the page's side of the conversation.
jest.mock('react-native-webview', () => {
  const React = require('react');
  const {View} = require('react-native');
  const WebView = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({
      injectJavaScript: js => {
        global.__WEBVIEW_JS = (global.__WEBVIEW_JS || []).concat(js);
      },
    }));
    React.useEffect(() => {
      global.__WEBVIEW_MOUNTS = (global.__WEBVIEW_MOUNTS || 0) + 1;
    }, []);
    return React.createElement(View, props);
  });
  // Tests set global.__WEBVIEW_MISSING to play a build without the native module.
  const mod = {__esModule: true, default: WebView};
  Object.defineProperty(mod, 'WebView', {
    enumerable: true,
    get() {
      global.__WEBVIEW_LOAD_ATTEMPTS = (global.__WEBVIEW_LOAD_ATTEMPTS || 0) + 1;
      if (global.__WEBVIEW_MISSING) {
        throw new Error('RNCWebView is not linked');
      }
      return WebView;
    },
  });
  return mod;
});

// Native geolocation: succeed at the default centre unless a test overrides it.
jest.mock('@react-native-community/geolocation', () => ({
  __esModule: true,
  default: {
    setRNConfiguration: jest.fn(),
    getCurrentPosition: jest.fn(success =>
      success({coords: {latitude: 28.6139, longitude: 77.209}}),
    ),
  },
}));

// RN's Jest mock of AppState returns no subscription; give listeners one.
require('react-native').AppState.addEventListener = jest.fn(() => ({
  remove: jest.fn(),
}));

// App code: no artificial latency, in-memory storage.
require('./src/services/mock/runtime').setFastMocks(true);
const storageModule = require('./src/store/storage');
storageModule.setStorage(storageModule.createMemoryStorage());

// No test may touch the network. By default every fetch fails like an
// unreachable server, which also exercises the on-device OTP fallback; tests
// that need a response replace `global.fetch` themselves.
global.fetch = jest.fn(() =>
  Promise.reject(new TypeError('Network request failed')),
);

// Match the native WebView availability without loading its enforcing entry point.
const turboModules = require('react-native').TurboModuleRegistry;
const getNativeModule = turboModules.get;
jest.spyOn(turboModules, 'get').mockImplementation(name => {
  if (name === 'RNCWebViewModule') {
    return global.__WEBVIEW_MISSING ? null : {};
  }
  return getNativeModule(name);
});

// Deliver decoded camera data without opening hardware during UI tests.
jest.mock('./src/components/QrCamera', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {QrCamera: props => React.createElement(View, {testID: 'qr-camera', ...props})};
});
