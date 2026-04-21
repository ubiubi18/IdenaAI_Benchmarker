module.exports = {
  transform: {
    '^.+\\.[jt]sx?$': 'babel-jest',
  },
  testPathIgnorePatterns: [
    '<rootDir>/renderer/.next/',
    '<rootDir>/renderer/out/',
    '<rootDir>/dist/',
    '<rootDir>/node_modules/',
  ],
}
