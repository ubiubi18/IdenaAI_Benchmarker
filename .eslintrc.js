module.exports = {
  plugins: ['testcafe'],
  extends: ['wesbos', 'plugin:testcafe/recommended'],
  rules: {
    'import/no-extraneous-dependencies': [
      'error',
      {
        devDependencies: [
          '.eslintrc.js',
          'renderer/**',
          'scripts/**',
          'test/**',
        ],
      },
    ],
    'no-use-before-define': ['error', 'nofunc'],
  },
}
