#!/usr/bin/env node

const fs = require('fs-extra')
const path = require('path')
const {decode} = require('rlp')

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

function trimText(value) {
  return String(value || '').trim()
}

function ensureHexPrefix(value) {
  const raw = trimText(value)
  if (!raw) {
    return ''
  }
  return raw.startsWith('0x') ? raw : `0x${raw}`
}

function decodeHexBuffer(value) {
  const normalized = ensureHexPrefix(value)
  if (!normalized || normalized === '0x') {
    return Buffer.alloc(0)
  }
  return Buffer.from(normalized.slice(2), 'hex')
}

function normalizeOrderIndex(value) {
  if (Array.isArray(value) && value.length > 0) {
    return normalizeOrderIndex(value[0])
  }

  if (Buffer.isBuffer(value)) {
    if (!value.length) {
      return 0
    }
    return Number.parseInt(value.toString('hex') || '0', 16)
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeOrders(rawOrders) {
  if (!Array.isArray(rawOrders)) {
    return []
  }

  return rawOrders.map((order) =>
    Array.isArray(order) ? order.map((entry) => normalizeOrderIndex(entry)) : []
  )
}

function decodePayload(payload) {
  const hex = trimText(payload && payload.hex)
  const privateHex = trimText(payload && payload.privateHex)
  let images = []
  let orders = []

  if (privateHex && privateHex !== '0x') {
    const publicDecoded = decode(decodeHexBuffer(hex))
    images = Array.isArray(publicDecoded && publicDecoded[0])
      ? publicDecoded[0]
      : []
    const privateDecoded = decode(decodeHexBuffer(privateHex))
    const privateImages = Array.isArray(privateDecoded && privateDecoded[0])
      ? privateDecoded[0]
      : []
    orders = normalizeOrders(privateDecoded && privateDecoded[1])
    images = images.concat(privateImages)
  } else {
    const decoded = decode(decodeHexBuffer(hex))
    images = Array.isArray(decoded && decoded[0]) ? decoded[0] : []
    orders = normalizeOrders(decoded && decoded[1])
  }

  return {
    images: images.map((entry) => Buffer.from(entry || [])),
    orders,
  }
}

function safeSlug(value) {
  return trimText(value)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function relativeImageMarkdown(relPath) {
  return `![panel](${relPath.replace(/\\/g, '/')})`
}

function buildTaskMarkdown(task) {
  const leftOrder = Array.isArray(task.leftOrder)
    ? task.leftOrder.map((item) => Number(item) + 1).join(', ')
    : ''
  const rightOrder = Array.isArray(task.rightOrder)
    ? task.rightOrder.map((item) => Number(item) + 1).join(', ')
    : ''
  const panelLines = task.panels
    .map(
      (panel, index) =>
        `### Panel ${index + 1}\n${relativeImageMarkdown(panel.markdownPath)}`
    )
    .join('\n\n')

  return [
    `# Human Teacher Task: ${task.taskId}`,
    '',
    `- Flip hash: \`${task.flipHash}\``,
    `- Epoch: \`${task.epoch}\``,
    `- Consensus answer: \`${task.finalAnswer}\``,
    `- Consensus strength: \`${task.consensusStrength || 'unknown'}\``,
    `- Candidate LEFT order: panels ${leftOrder || 'n/a'}`,
    `- Candidate RIGHT order: panels ${rightOrder || 'n/a'}`,
    '',
    '## What to annotate',
    '',
    '- Caption each panel in one short factual sentence.',
    '- Summarize the LEFT story and the RIGHT story.',
    '- Mark whether readable text is required to solve the flip.',
    '- Mark whether sequence markers are present.',
    '- Mark whether the flip should be reported.',
    '- Give the final answer: `left`, `right`, or `skip`.',
    '- Explain briefly why that answer is better than the alternatives.',
    '',
    '## Panels',
    '',
    panelLines,
    '',
    '## Annotation template',
    '',
    '```json',
    JSON.stringify(task.annotationTemplate, null, 2),
    '```',
    '',
  ].join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const packagePath = path.resolve(args.packagePath)
  const outputDir = path.resolve(args.outputDir)
  const teacherPackage = await fs.readJson(packagePath)
  const items = Array.isArray(teacherPackage && teacherPackage.items)
    ? teacherPackage.items
    : []

  const selectedItems = args.take > 0 ? items.slice(0, args.take) : items
  const tasksDir = path.join(outputDir, 'tasks')
  const manifestPath = path.join(outputDir, 'tasks.jsonl')
  const templatePath = path.join(outputDir, 'annotations.template.jsonl')

  await fs.ensureDir(tasksDir)
  const manifestRows = []
  const templateRows = []

  for (const item of selectedItems) {
    const payloadPath = path.resolve(trimText(item && item.payloadPath))
    const payload = await fs.readJson(payloadPath)
    const decoded = decodePayload(payload)

    if (decoded.images.length !== 4) {
      throw new Error(
        `Expected 4 panel images for ${item.flipHash}, got ${decoded.images.length}`
      )
    }
    if (!Array.isArray(decoded.orders) || decoded.orders.length < 2) {
      throw new Error(`Expected 2 candidate orders for ${item.flipHash}`)
    }

    const taskSlug = safeSlug(item.taskId || item.flipHash)
    const taskDir = path.join(tasksDir, taskSlug)
    await fs.ensureDir(taskDir)

    const panelEntries = []
    for (let index = 0; index < decoded.images.length; index += 1) {
      const fileName = `panel-${index + 1}.png`
      const filePath = path.join(taskDir, fileName)
      await fs.writeFile(filePath, decoded.images[index])
      panelEntries.push({
        fileName,
        relativePath: path.relative(outputDir, filePath),
        markdownPath: fileName,
      })
    }

    const annotationTemplate = {
      task_id: item.taskId,
      annotator: '',
      frame_captions: ['', '', '', ''],
      option_a_summary: '',
      option_b_summary: '',
      text_required: null,
      sequence_markers_present: null,
      report_required: null,
      report_reason: '',
      final_answer: '',
      why_answer: '',
      confidence: null,
    }

    const manifestRow = {
      task_id: item.taskId,
      sample_id: item.sampleId,
      flip_hash: item.flipHash,
      epoch: item.epoch,
      final_answer: item.finalAnswer,
      consensus_strength: item.consensusStrength,
      training_weight: item.trainingWeight,
      ranking_source: item.rankingSource,
      payload_path: payloadPath,
      left_order: decoded.orders[0],
      right_order: decoded.orders[1],
      words: item.words || {},
      selected_order: item.selectedOrder,
      panels: panelEntries.map((entry) => entry.relativePath),
    }

    const taskMarkdown = buildTaskMarkdown({
      taskId: item.taskId,
      flipHash: item.flipHash,
      epoch: item.epoch,
      finalAnswer: item.finalAnswer,
      consensusStrength: item.consensusStrength,
      leftOrder: decoded.orders[0],
      rightOrder: decoded.orders[1],
      panels: panelEntries,
      annotationTemplate,
    })

    await fs.writeFile(path.join(taskDir, 'README.md'), taskMarkdown, 'utf8')
    manifestRows.push(manifestRow)
    templateRows.push(annotationTemplate)
  }

  await fs.writeFile(
    manifestPath,
    `${manifestRows.map((row) => JSON.stringify(row)).join('\n')}\n`,
    'utf8'
  )
  await fs.writeFile(
    templatePath,
    `${templateRows.map((row) => JSON.stringify(row)).join('\n')}\n`,
    'utf8'
  )

  const summary = {
    packagePath,
    outputDir,
    tasks: manifestRows.length,
    templatePath,
    manifestPath,
  }
  await fs.writeJson(path.join(outputDir, 'summary.json'), summary, {
    spaces: 2,
  })
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error))
  process.exitCode = 1
})
