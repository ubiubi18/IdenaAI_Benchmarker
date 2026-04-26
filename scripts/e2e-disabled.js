console.error(
  [
    'Legacy TestCafe e2e checks are disabled.',
    'The old TestCafe/Electron runner depended on vulnerable, unmaintained dev tooling.',
    'Use npm run build:renderer, npm test, release checks, and manual Electron smoke tests until a Playwright replacement is added.',
  ].join('\n')
)

process.exit(1)
