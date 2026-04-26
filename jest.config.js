module.exports = {
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.[jt]sx?$': 'babel-jest',
  },
  testPathIgnorePatterns: [
    '<rootDir>/.tmp/',
    '<rootDir>/renderer/.next/',
    '<rootDir>/renderer/out/',
    '<rootDir>/dist/',
    '<rootDir>/node_modules/',
    '<rootDir>/vendor/',
  ],
}
