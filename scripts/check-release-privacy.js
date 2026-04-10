#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const {execFileSync} = require('child_process')

const SCANNED_PREFIXES = ['.github/', 'docs/', 'main/', 'renderer/', 'scripts/']

const SCANNED_FILES = new Set([
  '.env.example',
  'package.json',
  'README.md',
  'THIRD_PARTY_NOTICES.md',
])

const SKIPPED_EXTENSIONS = new Set([
  '.bin',
  '.gif',
  '.icns',
  '.ico',
  '.jpg',
  '.jpeg',
  '.lock',
  '.pdf',
  '.png',
  '.webp',
])

const CHECKS = [
  {
    name: 'macOS home path',
    regex:
      /(?<![A-Za-z0-9._@/-])\/Users\/(?!\$USER\b|\$HOME\b|Shared\b)[A-Za-z0-9._-]+/g,
  },
  {
    name: 'Windows home path',
    regex:
      /(?<![A-Za-z0-9._@/-])[A-Za-z]:\\Users\\(?!%USERNAME%\\|%USERPROFILE%\\)[^\\\s`'"]+/g,
  },
  {
    name: 'Linux home path',
    regex:
      /(?<![A-Za-z0-9._@/-])\/home\/(?!\$USER\b|\$HOME\b|runner\b|ubuntu\b)[A-Za-z0-9._-]+/g,
  },
  {
    name: 'OpenAI-like secret key',
    regex: /\bsk-(?!test\b|test-|custom\b|custom-)[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    name: 'Google API key',
    regex: /\bAIza[A-Za-z0-9_-]{20,}\b/g,
  },
]

function listTrackedFiles() {
  return execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    {encoding: 'utf8'}
  )
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function shouldScan(filePath) {
  if (SCANNED_FILES.has(filePath)) {
    return true
  }
  if (!SCANNED_PREFIXES.some((prefix) => filePath.startsWith(prefix))) {
    return false
  }
  return !SKIPPED_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

function inspectFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return []
  }

  const content = fs.readFileSync(filePath, 'utf8')
  const fileFindings = []

  for (const check of CHECKS) {
    check.regex.lastIndex = 0
    let match = check.regex.exec(content)
    while (match) {
      const line = content.slice(0, match.index).split('\n').length
      fileFindings.push({
        check: check.name,
        filePath,
        line,
        value: match[0],
      })
      match = check.regex.exec(content)
    }
  }

  return fileFindings
}

const findings = listTrackedFiles()
  .filter(shouldScan)
  .flatMap((filePath) => inspectFile(filePath))

if (findings.length > 0) {
  console.error('Release privacy check failed:')
  for (const finding of findings) {
    console.error(
      `- ${finding.filePath}:${finding.line} ${finding.check}: ${finding.value}`
    )
  }
  process.exit(1)
}

console.log('Release privacy check passed.')
