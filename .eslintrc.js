module.exports = {
  extends: ['wesbos'],
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
