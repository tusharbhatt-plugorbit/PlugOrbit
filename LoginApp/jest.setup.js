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
    return React.createElement(
      View,
      {testID: 'map', ...props},
      props.children,
    );
  });
  const Marker = props => React.createElement(View, props, props.children);
  const Polyline = () => null;
  return {__esModule: true, default: MapView, Marker, Polyline, PROVIDER_GOOGLE: 'google'};
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
