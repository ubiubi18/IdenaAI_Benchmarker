#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const {spawnSync} = require('child_process')

const rootDir = path.resolve(__dirname, '..')
const packagePath = path.join(rootDir, 'package.json')
const lockPath = path.join(rootDir, 'package-lock.json')
const baselinePath = path.join(
  rootDir,
  'scripts',
  'dependency-footprint-baseline.json'
)

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function directorySize(dirPath) {
  let total = 0
  const stack = [dirPath]

  while (stack.length > 0) {
    const nextPath = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(nextPath, {withFileTypes: true})
    } catch (_) {
      entries = null
    }

    if (entries) {
      for (const entry of entries) {
        const entryPath = path.join(nextPath, entry.name)
        try {
          if (entry.isDirectory()) {
            stack.push(entryPath)
          } else if (entry.isFile()) {
            total += fs.statSync(entryPath).size
          }
        } catch (_) {
          // Ignore transient filesystem races while walking node_modules.
        }
      }
    }
  }

  return total
}

function listTopNodeModules(limit = 15) {
  const nodeModulesPath = path.join(rootDir, 'node_modules')
  if (!fs.existsSync(nodeModulesPath)) return []

  const packages = []
  fs.readdirSync(nodeModulesPath, {withFileTypes: true}).forEach((entry) => {
    if (!entry.isDirectory() || entry.name.startsWith('.')) return
    const entryPath = path.join(nodeModulesPath, entry.name)

    if (entry.name.startsWith('@')) {
      fs.readdirSync(entryPath, {withFileTypes: true}).forEach(
        (scopedEntry) => {
          if (!scopedEntry.isDirectory()) return
          packages.push({
            name: `${entry.name}/${scopedEntry.name}`,
            bytes: directorySize(path.join(entryPath, scopedEntry.name)),
          })
        }
      )
      return
    }

    packages.push({name: entry.name, bytes: directorySize(entryPath)})
  })

  return packages.sort((a, b) => b.bytes - a.bytes).slice(0, limit)
}

function countProductionLockPackages(packageLockInput) {
  return Object.entries(packageLockInput.packages || {}).filter(
    ([name, meta]) => name.startsWith('node_modules/') && !meta.dev
  ).length
}

function runAuditSummary() {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const result = spawnSync(npmCommand, ['audit', '--omit=dev', '--json'], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const output = result.stdout || result.stderr
  try {
    const audit = JSON.parse(output)
    return {
      ok: result.status === 0,
      vulnerabilities: audit.metadata && audit.metadata.vulnerabilities,
    }
  } catch (_) {
    return {
      ok: false,
      vulnerabilities: null,
      error: output.trim() || 'npm audit did not return JSON',
    }
  }
}

function checkPackagedFileRisk(packageJsonInput) {
  const files = (((packageJsonInput || {}).build || {}).files || []).map(String)
  const packageFailures = []
  const requiredExcludes = [
    '!**/.env',
    '!**/.env.*',
    '!vendor',
    '!vendor/**',
    '!renderer',
    'renderer/out',
    '!downloads',
    '!downloads/**',
    '!data',
    '!data/**',
    '!logs',
    '!logs/**',
  ]

  requiredExcludes.forEach((entry) => {
    if (!files.includes(entry)) {
      packageFailures.push(`package build.files is missing ${entry}`)
    }
  })

  return packageFailures
}

function compareBaseline({
  currentRuntimeDependencies,
  currentProductionNodeModules,
}) {
  if (!fs.existsSync(baselinePath)) return []

  const baseline = readJson(baselinePath)
  const baselineFailures = []
  const expectedRuntime = (baseline.runtimeDependencies || []).slice().sort()

  if (currentRuntimeDependencies.join('\n') !== expectedRuntime.join('\n')) {
    const currentSet = new Set(currentRuntimeDependencies)
    const expectedSet = new Set(expectedRuntime)
    const added = currentRuntimeDependencies.filter(
      (dep) => !expectedSet.has(dep)
    )
    const removed = expectedRuntime.filter((dep) => !currentSet.has(dep))
    baselineFailures.push(
      `runtime dependency allowlist changed (added: ${
        added.join(', ') || 'none'
      }; removed: ${removed.join(', ') || 'none'})`
    )
  }

  if (
    Number.isFinite(baseline.maxProductionNodeModules) &&
    currentProductionNodeModules > baseline.maxProductionNodeModules
  ) {
    baselineFailures.push(
      `production transitive package count ${currentProductionNodeModules} exceeds baseline ${baseline.maxProductionNodeModules}`
    )
  }

  if (
    Number.isFinite(baseline.maxRootRuntimeDependencies) &&
    currentRuntimeDependencies.length > baseline.maxRootRuntimeDependencies
  ) {
    baselineFailures.push(
      `root runtime dependency count ${currentRuntimeDependencies.length} exceeds baseline ${baseline.maxRootRuntimeDependencies}`
    )
  }

  return baselineFailures
}

const packageJson = readJson(packagePath)
const packageLock = readJson(lockPath)
const runtimeDependencies = Object.keys(packageJson.dependencies || {}).sort()
const productionNodeModules = countProductionLockPackages(packageLock)
const topNodeModules = listTopNodeModules()
const auditSummary = runAuditSummary()
const failures = [
  ...compareBaseline({
    currentRuntimeDependencies: runtimeDependencies,
    currentProductionNodeModules: productionNodeModules,
  }),
  ...checkPackagedFileRisk(packageJson),
]

console.log('Dependency footprint audit')
console.log(`- Root runtime dependencies: ${runtimeDependencies.length}`)
console.log(
  `- Root dev dependencies: ${
    Object.keys(packageJson.devDependencies || {}).length
  }`
)
console.log(`- Production transitive packages: ${productionNodeModules}`)

if (auditSummary.vulnerabilities) {
  const summary = auditSummary.vulnerabilities
  console.log(
    `- npm audit --omit=dev: ${summary.total || 0} total (${
      summary.low || 0
    } low, ${summary.moderate || 0} moderate, ${summary.high || 0} high, ${
      summary.critical || 0
    } critical)`
  )
} else if (auditSummary.error) {
  console.warn(`- npm audit --omit=dev unavailable: ${auditSummary.error}`)
}

if (topNodeModules.length > 0) {
  console.log('- Largest installed packages:')
  topNodeModules.forEach((item) => {
    console.log(`  ${item.name}: ${formatSize(item.bytes)}`)
  })
}

if (failures.length > 0) {
  console.error('Dependency footprint audit failed:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log('Dependency footprint audit passed.')
