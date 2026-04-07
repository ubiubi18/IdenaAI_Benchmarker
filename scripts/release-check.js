#!/usr/bin/env node

const {spawnSync} = require('child_process')

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const syntaxCheckedFiles = [
  'scripts/clean-paths.js',
  'scripts/run-python.js',
  'scripts/check-release-privacy.js',
  'scripts/release-check.js',
  'main/channels.js',
  'main/index.js',
  'main/preload.js',
  'main/app-data-path.js',
  'main/stores/setup.js',
  'main/logger.js',
  'main/ai-providers/bridge.js',
]

function runStep(label, command, args) {
  console.log(`\n[release-check] ${label}`)
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  })

  if (result.error) {
    console.error(`[release-check] ${label} failed: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
}

for (const filePath of syntaxCheckedFiles) {
  runStep(`Syntax check ${filePath}`, process.execPath, ['--check', filePath])
}

runStep('ESLint', npmCommand, ['run', 'lint', '--', '--format', 'unix'])
runStep('Privacy audit', npmCommand, ['run', 'audit:privacy'])
runStep('AI bridge regression tests', npmCommand, [
  'test',
  '--',
  '--runInBand',
  'main/ai-providers/bridge.test.js',
])

console.log('\n[release-check] Passed.')
