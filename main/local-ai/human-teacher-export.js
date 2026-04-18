const crypto = require('crypto')
const fs = require('fs-extra')
const path = require('path')
const {decode} = require('rlp')

const HUMAN_TEACHER_WORKSPACE_TYPE =
  'local-ai-human-teacher-annotation-workspace'
const HUMAN_TEACHER_PACKAGE_TYPE = 'local-ai-human-teacher-tasks'

function trimText(value) {
  return String(value || '').trim()
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
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
    '- Keep the prefilled reference fields unchanged so the annotation stays bound to this flip task.',
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

function normalizeReviewStatus(value) {
  return trimText(value).toLowerCase()
}

function normalizeEpoch(value) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function assertExportableTeacherPackage(teacherPackage) {
  if (
    !teacherPackage ||
    typeof teacherPackage !== 'object' ||
    Array.isArray(teacherPackage)
  ) {
    throw new Error('Human teacher package is invalid')
  }

  if (trimText(teacherPackage.packageType) !== HUMAN_TEACHER_PACKAGE_TYPE) {
    throw new Error('Human teacher package type is invalid')
  }

  if (normalizeReviewStatus(teacherPackage.reviewStatus) !== 'approved') {
    throw new Error(
      'Human teacher package must be approved before annotation tasks can be exported'
    )
  }

  if (teacherPackage.annotationReady !== true) {
    throw new Error(
      'Human teacher package must be annotation-ready before export'
    )
  }

  const packageEpoch = normalizeEpoch(teacherPackage.epoch)

  if (packageEpoch === null) {
    throw new Error('Human teacher package epoch is invalid')
  }

  const items = Array.isArray(teacherPackage.items) ? teacherPackage.items : []

  if (!items.length) {
    throw new Error('Human teacher package does not contain any tasks')
  }

  const seenTaskIds = new Set()

  items.forEach((item, index) => {
    const taskId = trimText(item && item.taskId)

    if (!taskId) {
      throw new Error(`Human teacher task ${index + 1} is missing taskId`)
    }

    if (seenTaskIds.has(taskId)) {
      throw new Error(`Duplicate human teacher taskId: ${taskId}`)
    }

    seenTaskIds.add(taskId)

    if (!trimText(item && item.payloadPath)) {
      throw new Error(`Human teacher task ${taskId} is missing payloadPath`)
    }

    const itemEpoch = normalizeEpoch(item && item.epoch)

    if (itemEpoch !== null && itemEpoch !== packageEpoch) {
      throw new Error(
        `Human teacher task ${taskId} does not match package epoch ${packageEpoch}`
      )
    }
  })

  return {
    ...teacherPackage,
    epoch: packageEpoch,
    items,
  }
}

async function exportHumanTeacherTasks({
  packagePath,
  outputDir,
  take = 0,
} = {}) {
  const resolvedPackagePath = path.resolve(trimText(packagePath))
  const resolvedOutputDir = path.resolve(trimText(outputDir))

  if (!resolvedPackagePath || !resolvedOutputDir) {
    throw new Error('packagePath and outputDir are required')
  }

  const teacherPackage = assertExportableTeacherPackage(
    await fs.readJson(resolvedPackagePath)
  )
  const items = teacherPackage.items

  const selectedItems = take > 0 ? items.slice(0, take) : items
  const tasksDir = path.join(resolvedOutputDir, 'tasks')
  const manifestPath = path.join(resolvedOutputDir, 'tasks.jsonl')
  const templatePath = path.join(
    resolvedOutputDir,
    'annotations.template.jsonl'
  )
  const filledPath = path.join(resolvedOutputDir, 'annotations.filled.jsonl')
  const metadataPath = path.join(resolvedOutputDir, 'workspace-metadata.json')

  await fs.remove(resolvedOutputDir)
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
        relativePath: path.relative(resolvedOutputDir, filePath),
        markdownPath: fileName,
      })
    }

    const annotationTemplate = {
      task_id: item.taskId,
      sample_id: item.sampleId || item.taskId,
      flip_hash: item.flipHash || '',
      epoch: item.epoch ?? teacherPackage.epoch,
      consensus_answer: item.finalAnswer || '',
      consensus_strength: item.consensusStrength || '',
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

  const manifestContent = manifestRows.length
    ? `${manifestRows.map((row) => JSON.stringify(row)).join('\n')}\n`
    : ''
  const templateContent = templateRows.length
    ? `${templateRows.map((row) => JSON.stringify(row)).join('\n')}\n`
    : ''

  await fs.writeFile(
    manifestPath,
    manifestContent,
    'utf8'
  )
  await fs.writeFile(templatePath, templateContent, 'utf8')
  await fs.writeFile(filledPath, templateContent, 'utf8')

  const metadata = {
    schemaVersion: 1,
    workspaceType: HUMAN_TEACHER_WORKSPACE_TYPE,
    exportedAt: new Date().toISOString(),
    packagePath: resolvedPackagePath,
    packageType: teacherPackage.packageType,
    epoch: teacherPackage.epoch,
    reviewStatus: teacherPackage.reviewStatus,
    annotationReady: true,
    taskCount: manifestRows.length,
    taskIds: manifestRows.map((row) => row.task_id),
    taskManifestPath: manifestPath,
    annotationsTemplatePath: templatePath,
    annotationsFilledPath: filledPath,
    taskManifestSha256: sha256(manifestContent),
  }

  await fs.writeJson(metadataPath, metadata, {spaces: 2})

  const summary = {
    packagePath: resolvedPackagePath,
    outputDir: resolvedOutputDir,
    tasks: manifestRows.length,
    templatePath,
    filledPath,
    manifestPath,
    metadataPath,
    manifestSha256: metadata.taskManifestSha256,
  }

  await fs.writeJson(path.join(resolvedOutputDir, 'summary.json'), summary, {
    spaces: 2,
  })

  return summary
}

module.exports = {
  exportHumanTeacherTasks,
}
