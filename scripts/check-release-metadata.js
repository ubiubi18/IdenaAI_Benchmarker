#!/usr/bin/env node

const fs = require('fs')
const {execFileSync} = require('child_process')

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
  'Active desktop app fork from upstream `idena-desktop`',
  'Community AI benchmark/helper modifications',
  '2026 ubiubi18',
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

const trackedFiles = new Set(
  execFileSync('git', ['ls-files'], {encoding: 'utf8'})
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean)
)

function requireCondition(condition, message) {
  if (!condition) {
    failures.push(message)
  }
}

for (const filePath of expectedFiles) {
  requireCondition(fs.existsSync(filePath), `Missing release file: ${filePath}`)
  requireCondition(
    trackedFiles.has(filePath),
    `Release file is not tracked by git: ${filePath}`
  )
}

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'))

requireCondition(
  packageJson.name === 'idena-ai',
  'package.json name must remain idena-ai'
)
requireCondition(
  packageJson.productName === 'IdenaAI',
  'package.json productName must remain IdenaAI'
)
requireCondition(
  packageJson.repository &&
    packageJson.repository.url === 'https://github.com/ubiubi18/IdenaAI.git',
  'package.json repository must point to the main IdenaAI repo'
)
requireCondition(
  packageJson.homepage === 'https://github.com/ubiubi18/IdenaAI#readme',
  'package.json homepage must point to the main IdenaAI repo'
)
requireCondition(
  packageJson.bugs &&
    packageJson.bugs.url === 'https://github.com/ubiubi18/IdenaAI/issues',
  'package.json bugs URL must point to the main IdenaAI repo'
)
requireCondition(
  packageJson.author === 'ubiubi18',
  'package.json author must be set for release metadata'
)
requireCondition(
  packageJson.build &&
    packageJson.build.publish &&
    packageJson.build.publish[0] &&
    packageJson.build.publish[0].provider === 'github' &&
    packageJson.build.publish[0].owner === 'ubiubi18' &&
    packageJson.build.publish[0].repo === 'IdenaAI',
  'package.json build.publish must point to the IdenaAI GitHub release feed'
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
