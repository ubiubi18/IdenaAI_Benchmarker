const path = require('path')
const fs = require('fs-extra')

const DEMO_SAMPLE_DEFINITIONS = Object.freeze({
  'flip-challenge-test-5-decoded-labeled': {
    label: 'Quick demo (5 flips)',
    relativePath: path.join(
      '..',
      '..',
      'samples',
      'flips',
      'flip-challenge-test-5-decoded-labeled.json'
    ),
  },
  'flip-challenge-test-20-decoded-labeled': {
    label: 'Larger demo (20 flips)',
    relativePath: path.join(
      '..',
      '..',
      'samples',
      'flips',
      'flip-challenge-test-20-decoded-labeled.json'
    ),
  },
})

const DEVELOPER_SAMPLE_DEFINITIONS = Object.freeze({
  'flip-challenge-test-20-decoded-labeled': {
    label: 'Balanced training slice (500 flips)',
    relativePath: path.join(
      '..',
      '..',
      'samples',
      'flips',
      'flip-challenge-human-teacher-500-balanced.json'
    ),
  },
})

const DEFAULT_DEMO_SAMPLE_NAME = 'flip-challenge-test-5-decoded-labeled'
const DEFAULT_DEVELOPER_SAMPLE_NAME = 'flip-challenge-test-20-decoded-labeled'

function trimText(value) {
  return String(value || '').trim()
}

function normalizeSampleName(value, definitions, fallbackSampleName) {
  const sampleName = trimText(value)

  if (sampleName && definitions[sampleName]) {
    return sampleName
  }

  return fallbackSampleName
}

function normalizeDemoSampleName(value) {
  return normalizeSampleName(
    value,
    DEMO_SAMPLE_DEFINITIONS,
    DEFAULT_DEMO_SAMPLE_NAME
  )
}

function normalizeDeveloperHumanTeacherSampleName(value) {
  return normalizeSampleName(
    value,
    DEVELOPER_SAMPLE_DEFINITIONS,
    DEFAULT_DEVELOPER_SAMPLE_NAME
  )
}

function listSamples(definitions) {
  return Object.entries(definitions).map(([sampleName, entry]) => ({
    sampleName,
    label: entry.label,
  }))
}

function listHumanTeacherDemoSamples() {
  return listSamples(DEMO_SAMPLE_DEFINITIONS)
}

function listDeveloperHumanTeacherSamples() {
  return listSamples(DEVELOPER_SAMPLE_DEFINITIONS)
}

function safeSlug(value) {
  return trimText(value)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function decodeImageDataUrl(dataUrl) {
  const raw = trimText(dataUrl)
  const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/u)

  if (!match) {
    throw new Error('Invalid demo image data URL')
  }

  const [, mimeType, base64Data] = match
  let extension = 'png'

  if (mimeType === 'image/jpeg') {
    extension = 'jpg'
  } else if (mimeType === 'image/webp') {
    extension = 'webp'
  }

  return {
    extension,
    buffer: Buffer.from(base64Data, 'base64'),
  }
}

function normalizePanelExtension(filePath) {
  const extension = trimText(path.extname(filePath))
    .replace(/^\./u, '')
    .toLowerCase()

  if (extension === 'jpeg') {
    return 'jpg'
  }

  if (extension === 'png' || extension === 'jpg' || extension === 'webp') {
    return extension
  }

  return 'png'
}

function resolvePanelSourcePath(panelSource, samplePath) {
  const rawPanelSource = trimText(panelSource)

  if (!rawPanelSource) {
    throw new Error('Invalid demo image source path')
  }

  if (path.isAbsolute(rawPanelSource)) {
    return rawPanelSource
  }

  return path.resolve(path.dirname(samplePath), rawPanelSource)
}

async function decodePanelSource(panelSource, samplePath) {
  const rawPanelSource = trimText(panelSource)

  if (!rawPanelSource) {
    throw new Error('Invalid demo image source')
  }

  if (rawPanelSource.startsWith('data:image/')) {
    return decodeImageDataUrl(rawPanelSource)
  }

  const resolvedPath = resolvePanelSourcePath(rawPanelSource, samplePath)

  return {
    extension: normalizePanelExtension(resolvedPath),
    buffer: await fs.readFile(resolvedPath),
  }
}

function createAnnotationTemplate(taskId) {
  return {
    task_id: taskId,
    annotator: '',
    frame_captions: ['', '', '', ''],
    option_a_summary: '',
    option_b_summary: '',
    ai_annotation: null,
    ai_annotation_feedback: '',
    text_required: null,
    sequence_markers_present: null,
    report_required: null,
    report_reason: '',
    final_answer: '',
    why_answer: '',
    confidence: null,
  }
}

async function loadHumanTeacherSample(
  sampleName,
  definitions,
  fallbackSampleName
) {
  const nextSampleName = normalizeSampleName(
    sampleName,
    definitions,
    fallbackSampleName
  )
  const definition = definitions[nextSampleName]
  const samplePath = path.resolve(__dirname, definition.relativePath)
  const raw = await fs.readJson(samplePath)
  const flips = Array.isArray(raw && raw.flips) ? raw.flips : []

  return {
    sampleName: nextSampleName,
    label: definition.label,
    sourcePath: samplePath,
    totalFlips: flips.length,
    flips,
  }
}

async function loadHumanTeacherDemoSample(sampleName) {
  return loadHumanTeacherSample(
    sampleName,
    DEMO_SAMPLE_DEFINITIONS,
    DEFAULT_DEMO_SAMPLE_NAME
  )
}

async function loadDeveloperHumanTeacherSample(sampleName) {
  return loadHumanTeacherSample(
    sampleName,
    DEVELOPER_SAMPLE_DEFINITIONS,
    DEFAULT_DEVELOPER_SAMPLE_NAME
  )
}

async function buildHumanTeacherDemoWorkspace({
  outputDir,
  sampleName,
  take = 0,
  offset = 0,
  loadSample = loadHumanTeacherDemoSample,
} = {}) {
  const resolvedOutputDir = path.resolve(trimText(outputDir))

  if (!resolvedOutputDir) {
    throw new Error('outputDir is required')
  }

  const sample = await loadSample(sampleName)
  const nextOffset =
    Number.isFinite(Number(offset)) && Number(offset) > 0 ? Number(offset) : 0
  const selectedFlips =
    Number.isFinite(Number(take)) && Number(take) > 0
      ? sample.flips.slice(nextOffset, nextOffset + Number(take))
      : sample.flips.slice(nextOffset)

  if (!selectedFlips.length) {
    throw new Error('Human-teacher demo sample does not contain any flips')
  }

  const tasksDir = path.join(resolvedOutputDir, 'tasks')
  const manifestPath = path.join(resolvedOutputDir, 'tasks.jsonl')
  const templatePath = path.join(
    resolvedOutputDir,
    'annotations.template.jsonl'
  )
  const filledPath = path.join(resolvedOutputDir, 'annotations.filled.jsonl')
  const metadataPath = path.join(resolvedOutputDir, 'demo-metadata.json')

  await fs.remove(resolvedOutputDir)
  await fs.ensureDir(tasksDir)

  const manifestRows = []
  const templateRows = []

  for (const [index, flip] of selectedFlips.entries()) {
    const absoluteIndex = nextOffset + index + 1
    const taskId = `demo:${sample.sampleName}:${absoluteIndex}`
    const taskDir = path.join(tasksDir, safeSlug(taskId))
    await fs.ensureDir(taskDir)

    const panelSources =
      Array.isArray(flip.panelPaths) && flip.panelPaths.length
        ? flip.panelPaths.slice(0, 4)
        : (Array.isArray(flip.images) ? flip.images : []).slice(0, 4)

    const panels = await Promise.all(
      panelSources.map(async (panelSource, imageIndex) => {
        const decoded = await decodePanelSource(panelSource, sample.sourcePath)
        const fileName = `panel-${imageIndex + 1}.${decoded.extension}`
        const filePath = path.join(taskDir, fileName)
        await fs.writeFile(filePath, decoded.buffer)

        return {
          fileName,
          relativePath: path.relative(resolvedOutputDir, filePath),
        }
      })
    )

    if (panels.length !== 4) {
      throw new Error(
        `Expected 4 demo panel images for ${flip.hash || taskId}, got ${
          panels.length
        }`
      )
    }

    const annotationTemplate = createAnnotationTemplate(taskId)
    const leftOrder = Array.isArray(flip.orders && flip.orders[0])
      ? flip.orders[0]
      : []
    const rightOrder = Array.isArray(flip.orders && flip.orders[1])
      ? flip.orders[1]
      : []

    manifestRows.push({
      task_id: taskId,
      sample_id: taskId,
      flip_hash: trimText(flip.hash) || taskId,
      epoch: null,
      final_answer: trimText(flip.expectedAnswer).toLowerCase() || null,
      consensus_strength:
        trimText(flip.expectedStrength || flip.consensusStrength) || 'Demo',
      training_weight: null,
      ranking_source: 'offline_demo_sample',
      payload_path: null,
      left_order: leftOrder,
      right_order: rightOrder,
      words: {},
      selected_order: null,
      panels: panels.map((panel) => panel.relativePath),
      demo: {
        sampleName: sample.sampleName,
        sampleLabel: sample.label,
      },
    })
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
  await fs.writeFile(filledPath, '', 'utf8')
  await fs.writeJson(
    metadataPath,
    {
      demo: true,
      sampleName: sample.sampleName,
      label: sample.label,
      sourcePath: sample.sourcePath,
      totalFlips: sample.totalFlips,
      offset: nextOffset,
      exportedTasks: manifestRows.length,
    },
    {spaces: 2}
  )

  return {
    demo: true,
    sampleName: sample.sampleName,
    sampleLabel: sample.label,
    outputDir: resolvedOutputDir,
    offset: nextOffset,
    totalFlips: sample.totalFlips,
    tasks: manifestRows.length,
    manifestPath,
    templatePath,
    filledPath,
    metadataPath,
  }
}

module.exports = {
  DEFAULT_DEMO_SAMPLE_NAME,
  DEFAULT_DEVELOPER_SAMPLE_NAME,
  buildHumanTeacherDemoWorkspace,
  listDeveloperHumanTeacherSamples,
  listHumanTeacherDemoSamples,
  loadDeveloperHumanTeacherSample,
  loadHumanTeacherDemoSample,
  normalizeDemoSampleName,
  normalizeDeveloperHumanTeacherSampleName,
}
