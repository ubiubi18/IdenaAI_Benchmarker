#!/usr/bin/env node

const fs = require('fs')

const expectedFiles = [
  'LICENSE',
  'LICENSES/MIT.txt',
  'LICENSES/LGPL-3.0.txt',
  'THIRD_PARTY_NOTICES.md',
  '.env.example',
  'requirements.txt',
]

const requiredPackageExcludes = [
  '!**/.env',
  '!**/.env.*',
  '!**/*.log',
  '!.tmp/**',
  '!tmp/**',
  '!data/**',
  '!logs/**',
  '!coverage/**',
]

const requiredNoticeSnippets = [
  'Active desktop app fork and AI benchmark helper code',
  'idena-go/',
  'idena-wasm-binding/',
  'LGPL-3.0',
]

const requiredEnvKeys = [
  'IDENAAI_PROVIDER_DEFAULT=',
  'IDENAAI_OPENAI_MODEL=',
  'IDENAAI_GEMINI_MODEL=',
  'IDENAAI_USE_PY_FLIP_PIPELINE=',
  'IDENAAI_PYTHON=',
  'IDENAAI_BENCH_LOGGING=',
  'IDENAAI_BENCH_LOG_MAX_MB=',
]

const failures = []

function requireCondition(condition, message) {
  if (!condition) {
    failures.push(message)
  }
}

for (const filePath of expectedFiles) {
  requireCondition(fs.existsSync(filePath), `Missing release file: ${filePath}`)
}

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'))

requireCondition(
  packageJson.name === 'idena-desktop',
  'package.json name must remain idena-desktop'
)
requireCondition(
  packageJson.productName === 'idena-desktop',
  'package.json productName must remain idena-desktop'
)
requireCondition(
  packageJson.repository &&
    packageJson.repository.url ===
      'https://github.com/ubiubi18/IdenaAI_Benchmarker.git',
  'package.json repository must point to the benchmark fork'
)
requireCondition(
  packageJson.homepage ===
    'https://github.com/ubiubi18/IdenaAI_Benchmarker#readme',
  'package.json homepage must point to the benchmark fork'
)
requireCondition(
  packageJson.bugs &&
    packageJson.bugs.url ===
      'https://github.com/ubiubi18/IdenaAI_Benchmarker/issues',
  'package.json bugs URL must point to the benchmark fork'
)

const buildFiles = new Set(
  packageJson.build && Array.isArray(packageJson.build.files)
    ? packageJson.build.files
    : []
)
for (const pattern of requiredPackageExcludes) {
  requireCondition(
    buildFiles.has(pattern),
    `package.json build.files must exclude ${pattern}`
  )
}

const notices = fs.existsSync('THIRD_PARTY_NOTICES.md')
  ? fs.readFileSync('THIRD_PARTY_NOTICES.md', 'utf8')
  : ''
for (const snippet of requiredNoticeSnippets) {
  requireCondition(
    notices.includes(snippet),
    `THIRD_PARTY_NOTICES.md must mention ${snippet}`
  )
}

const envExample = fs.existsSync('.env.example')
  ? fs.readFileSync('.env.example', 'utf8')
  : ''
for (const key of requiredEnvKeys) {
  requireCondition(envExample.includes(key), `.env.example must define ${key}`)
}

if (failures.length > 0) {
  console.error('Release metadata check failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Release metadata check passed.')
