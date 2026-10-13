module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['./jest.setup.js'],
  // Whole-app screen tests render hundreds of nodes; on a busy machine or CI runner a few
  // of them can exceed the default 5 s without being broken.
  testTimeout: 20000,
};
