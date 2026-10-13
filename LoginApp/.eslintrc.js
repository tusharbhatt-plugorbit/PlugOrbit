module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    // Screens read the live palette with `const {colors} = useAppearance()`, which
    // deliberately shadows the static `colors` from theme.ts that their style sheets use.
    '@typescript-eslint/no-shadow': ['warn', {allow: ['colors']}],
  },
};
