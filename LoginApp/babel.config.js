module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // Inlines values from LoginApp/.env at bundle time: `import {X} from '@env'`.
    [
      'module:react-native-dotenv',
      {
        moduleName: '@env',
        path: '.env',
        safe: false,
        allowUndefined: true,
      },
    ],
  ],
};
