#!/usr/bin/env node

const {spawnSync} = require('child_process')
const path = require('path')

const nextBin = path.join(
  __dirname,
  '..',
  'node_modules',
  'next',
  'dist',
  'bin',
  'next'
)

const baseNodeOptions = process.env.NODE_OPTIONS || ''
const needsLegacyProvider =
  Number.parseInt(process.versions.node.split('.')[0], 10) >= 17 &&
  !baseNodeOptions.includes('--openssl-legacy-provider')

const env = {
  ...process.env,
  NODE_OPTIONS: needsLegacyProvider
    ? `${baseNodeOptions} --openssl-legacy-provider`.trim()
    : baseNodeOptions,
}

function runNext(args) {
  const result = spawnSync(process.execPath, [nextBin, ...args], {
    cwd: path.join(__dirname, '..'),
    env,
    stdio: 'inherit',
  })

  if (result.error) {
    console.error(`next ${args.join(' ')} failed: ${result.error.message}`)
    process.exit(1)
  }

  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
}

runNext(['build', 'renderer'])
runNext(['export', 'renderer'])
