#!/usr/bin/env node

const {devDependencies} = require('../package.json')

const MIN_NODE_VERSION = [20, 20, 0]
const RECOMMENDED_PACKAGING_NODE_VERSION = [22, 12, 0]

function parseNodeVersion(value) {
  return String(value || '')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0)
    .slice(0, 3)
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    const leftPart = left[index] || 0
    const rightPart = right[index] || 0

    if (leftPart > rightPart) return 1
    if (leftPart < rightPart) return -1
  }

  return 0
}

function formatVersion(parts) {
  return parts.join('.')
}

const nodeVersion = parseNodeVersion(process.versions.node)
const electronVersion = devDependencies.electron
const minNodeVersionLabel = formatVersion(MIN_NODE_VERSION)
const recommendedPackagingNodeVersionLabel = formatVersion(
  RECOMMENDED_PACKAGING_NODE_VERSION
)

if (compareVersions(nodeVersion, MIN_NODE_VERSION) < 0) {
  console.error(
    [
      `This repo targets Electron ${electronVersion} and requires Node ${minNodeVersionLabel}+ for local development.`,
      `Current Node version: ${process.versions.node}`,
      'Upgrade Node before running npm install or npm ci.',
    ].join('\n')
  )
  process.exit(1)
}

if (compareVersions(nodeVersion, RECOMMENDED_PACKAGING_NODE_VERSION) < 0) {
  console.warn(
    [
      `This repo can run development installs on Node ${minNodeVersionLabel}+, but Electron ${electronVersion} packaging is cleanest on Node ${recommendedPackagingNodeVersionLabel}+.`,
      `Current Node version: ${process.versions.node}`,
      'Use Node 22.12+ before producing release artifacts.',
    ].join('\n')
  )
}
