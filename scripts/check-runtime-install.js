#!/usr/bin/env node

const {devDependencies} = require('../package.json')

const MIN_NODE_MAJOR = 20
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10)

if (nodeMajor < MIN_NODE_MAJOR) {
  console.error(
    [
      `This repo targets Electron ${devDependencies.electron} and requires Node ${MIN_NODE_MAJOR}+ for local development.`,
      `Current Node version: ${process.versions.node}`,
      'Upgrade Node before running npm install or npm ci.',
    ].join('\n')
  )
  process.exit(1)
}
