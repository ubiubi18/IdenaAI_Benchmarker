#!/usr/bin/env node

const path = require('path')
// eslint-disable-next-line import/no-extraneous-dependencies
const {rebuild} = require('@electron/rebuild')
const pkg = require('../package.json')

const ROOT = path.join(__dirname, '..')
const RUNTIME_NATIVE_MODULES = ['leveldown', 'secp256k1']

async function main() {
  await rebuild({
    buildPath: ROOT,
    electronVersion: pkg.devDependencies.electron,
    force: true,
    mode: 'sequential',
    onlyModules: RUNTIME_NATIVE_MODULES,
  })
}

main().catch((error) => {
  console.error(
    `Failed to rebuild Electron runtime native modules (${RUNTIME_NATIVE_MODULES.join(
      ', '
    )}): ${error.message}`
  )
  process.exit(1)
})
