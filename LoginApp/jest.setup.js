/* eslint-env jest */
// react-native-safe-area-context waits for native inset data before rendering
// children, which never arrives under Jest. Use the library's official mock.
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
