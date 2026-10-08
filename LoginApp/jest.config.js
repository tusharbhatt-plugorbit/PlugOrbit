module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['./jest.setup.js'],
  // Whole-app screen tests mount a lot of UI; the default 5 s is tight when
  // suites run in parallel on a small CI box.
  testTimeout: 20000,
};
