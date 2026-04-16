#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const {spawnSync} = require('child_process')
// eslint-disable-next-line import/no-extraneous-dependencies
const {rebuild} = require('@electron/rebuild')
const pkg = require('../package.json')

const ROOT = path.join(__dirname, '..')
const RUNTIME_NATIVE_MODULES = ['leveldown', 'secp256k1']

function readCommandOutput(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
  })

  return String(result.stdout || '').trim()
}

function detectRebuildArch() {
  if (process.platform !== 'darwin') {
    return undefined
  }

  // When Node runs under Rosetta, `process.arch` and `uname -m` can both report
  // x64 even though Electron launches natively as arm64 on Apple Silicon.
  const supportsArm64 = readCommandOutput('/usr/sbin/sysctl', [
    '-in',
    'hw.optional.arm64',
  ])
  if (supportsArm64 === '1') {
    return 'arm64'
  }

  const machineArch = readCommandOutput('/usr/bin/uname', ['-m'])

  return machineArch === 'arm64' ? 'arm64' : undefined
}

function ensureNativeModuleBuild(moduleName, artifactRelativePath) {
  const moduleRoot = path.join(ROOT, 'node_modules', moduleName)
  const artifactPath = path.join(moduleRoot, artifactRelativePath)

  if (fs.existsSync(artifactPath)) {
    return
  }

  const args = [
    require.resolve('node-gyp/bin/node-gyp.js'),
    'rebuild',
    `--target=${pkg.devDependencies.electron}`,
    '--runtime=electron',
    '--dist-url=https://electronjs.org/headers',
  ]

  const arch = detectRebuildArch()
  if (arch) {
    args.push(`--arch=${arch}`)
  }

  const result = spawnSync(process.execPath, args, {
    cwd: moduleRoot,
    stdio: 'inherit',
  })

  if (result.status !== 0 || !fs.existsSync(artifactPath)) {
    throw new Error(
      `Failed to build ${moduleName} for Electron runtime (missing ${artifactRelativePath})`
    )
  }
}

async function main() {
  await rebuild({
    buildPath: ROOT,
    electronVersion: pkg.devDependencies.electron,
    arch: detectRebuildArch(),
    force: true,
    mode: 'sequential',
    onlyModules: RUNTIME_NATIVE_MODULES,
  })

  // Some old native addons still need an explicit node-gyp fallback on Apple Silicon.
  ensureNativeModuleBuild(
    'leveldown',
    path.join('build', 'Release', 'leveldown.node')
  )
  ensureNativeModuleBuild(
    'secp256k1',
    path.join('build', 'Release', 'addon.node')
  )
}

main().catch((error) => {
  console.error(
    `Failed to rebuild Electron runtime native modules (${RUNTIME_NATIVE_MODULES.join(
      ', '
    )}): ${error.message}`
  )
  process.exit(1)
})
