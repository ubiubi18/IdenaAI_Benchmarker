#!/usr/bin/env node

const os = require('os')
const {devDependencies} = require('../package.json')

if (process.platform === 'darwin' && os.arch() === 'arm64') {
  const electronVersion = devDependencies.electron
  console.error(
    [
      `This repo currently targets Electron ${electronVersion}, which does not ship a darwin-arm64 binary.`,
      'Use an x64 Node shell under Rosetta before running npm install or npm ci.',
      'Example:',
      '  arch -x86_64 zsh',
      '  nvm use 20',
      '  npm ci',
    ].join('\n')
  )
  process.exit(1)
}
