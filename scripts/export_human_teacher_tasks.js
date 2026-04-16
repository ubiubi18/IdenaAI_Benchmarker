#!/usr/bin/env node

const {
  exportHumanTeacherTasks,
} = require('../main/local-ai/human-teacher-export')

function parseArgs(argv) {
  const args = {
    packagePath: '',
    outputDir: '',
    take: 0,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--package-path') {
      args.packagePath = String(argv[index + 1] || '')
      index += 1
    } else if (token === '--output-dir') {
      args.outputDir = String(argv[index + 1] || '')
      index += 1
    } else if (token === '--take') {
      args.take = Number.parseInt(argv[index + 1], 10) || 0
      index += 1
    }
  }

  if (!args.packagePath || !args.outputDir) {
    throw new Error(
      'Usage: node scripts/export_human_teacher_tasks.js --package-path <path> --output-dir <dir> [--take 30]'
    )
  }

  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const summary = await exportHumanTeacherTasks(args)
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error && error.stack ? error.stack : String(error))
  process.exitCode = 1
})
