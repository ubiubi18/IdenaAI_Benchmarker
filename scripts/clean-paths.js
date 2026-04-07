#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const paths = process.argv.slice(2)

if (paths.length === 0) {
  console.error('Usage: node scripts/clean-paths.js <path> [path...]')
  process.exit(1)
}

for (const entry of paths) {
  const target = path.resolve(process.cwd(), entry)
  fs.rmSync(target, {recursive: true, force: true})
}
