#!/usr/bin/env node

const {spawnSync} = require('child_process')
const fs = require('fs')
const path = require('path')

const projectRoot = path.join(__dirname, '..')

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
  BROWSERSLIST_IGNORE_OLD_DATA: '1',
  NODE_OPTIONS: needsLegacyProvider
    ? `${baseNodeOptions} --openssl-legacy-provider`.trim()
    : baseNodeOptions,
}

function runNext(args) {
  const result = spawnSync(process.execPath, [nextBin, ...args], {
    cwd: projectRoot,
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

function cleanRendererBuildOutput() {
  ;['renderer/.next', 'renderer/out'].forEach((relativePath) => {
    fs.rmSync(path.join(projectRoot, relativePath), {
      recursive: true,
      force: true,
    })
  })
}

cleanRendererBuildOutput()
runNext(['build', 'renderer'])
runNext(['export', 'renderer'])
