#!/usr/bin/env node

const {spawn} = require('child_process')

const args = process.argv.slice(2)

if (args.length === 0) {
  console.error('Usage: node scripts/run-python.js <script.py> [args...]')
  process.exit(1)
}

const configured = String(
  process.env.IDENAAI_PYTHON ||
    (process.platform === 'win32' ? 'py -3' : 'python3')
).trim()

const [command, ...prefixArgs] = configured.split(/\s+/g).filter(Boolean)

if (!command) {
  console.error('IDENAAI_PYTHON resolved to an empty command')
  process.exit(1)
}

const child = spawn(command, prefixArgs.concat(args), {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
})

child.on('error', (error) => {
  console.error(error.message)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code == null ? 1 : code)
})
