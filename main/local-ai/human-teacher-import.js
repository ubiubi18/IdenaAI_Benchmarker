const fs = require('fs-extra')
const path = require('path')

const VALID_FINAL_ANSWERS = new Set(['left', 'right', 'skip'])

function trimText(value, maxLength = 2000) {
  return String(value || '')
    .trim()
    .slice(0, maxLength)
}

function normalizeBool(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null
  }

  if (typeof value === 'boolean') {
    return value
  }

  const raw = String(value).trim().toLowerCase()

  if (['true', 'yes', '1'].includes(raw)) {
    return true
  }

  if (['false', 'no', '0'].includes(raw)) {
    return false
  }

  return null
}

function normalizeConfidence(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null
  }

  const parsed = Number.parseFloat(value)

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null
  }

  if (parsed <= 1) {
    return Math.min(5, Math.max(1, Math.round(parsed * 4 + 1)))
  }

  if (parsed > 5) {
    return null
  }

  return Math.round(parsed)
}

function normalizeCaptions(value) {
  const captions = Array.isArray(value)
    ? value.slice(0, 4).map((item) => trimText(item, 400))
    : []

  while (captions.length < 4) {
    captions.push('')
  }

  return captions
}

function normalizePanelReferenceIndex(value) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 3) {
    return null
  }

  return parsed
}

function normalizePanelReferenceCoordinate(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null
  }

  const parsed = Number.parseFloat(value)

  if (!Number.isFinite(parsed)) {
    return null
  }

  return Math.max(0, Math.min(1, parsed))
}

function normalizePanelReferences(value) {
  let source = []

  if (Array.isArray(value)) {
    source = value
  } else if (value && typeof value === 'object') {
    source = ['A', 'B', 'C'].map((code) => {
      const raw =
        value[code] ||
        value[code.toLowerCase()] ||
        value[String(code || '').toUpperCase()] ||
        {}

      return typeof raw === 'string' ? {code, description: raw} : {code, ...raw}
    })
  }
  const byCode = new Map(
    source
      .map((entry, index) => {
        const code = String(entry?.code || ['A', 'B', 'C'][index] || '')
          .trim()
          .toUpperCase()

        return [code, entry]
      })
      .filter(([code]) => ['A', 'B', 'C'].includes(code))
  )

  return ['A', 'B', 'C'].map((code) => {
    const raw = byCode.get(code) || {}
    const panelIndex = normalizePanelReferenceIndex(
      raw.panel_index ?? raw.panelIndex
    )

    return {
      code,
      description: trimText(raw.description, 160),
      panel_index: panelIndex,
      x: panelIndex === null ? null : normalizePanelReferenceCoordinate(raw.x),
      y: panelIndex === null ? null : normalizePanelReferenceCoordinate(raw.y),
    }
  })
}

function validateFinalAnswer(value) {
  const answer = trimText(value, 16).toLowerCase()

  if (!VALID_FINAL_ANSWERS.has(answer)) {
    throw new Error(`Invalid final_answer: ${answer || 'empty'}`)
  }

  return answer
}

async function loadJsonl(filePath) {
  const targetPath = path.resolve(String(filePath || '').trim())

  if (!targetPath) {
    throw new Error('filePath is required')
  }

  const raw = await fs.readFile(targetPath, 'utf8')

  return raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function normalizeAiAnnotation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const rating = String(value.rating || '')
    .trim()
    .toLowerCase()
  const rawFinalAnswer = trimText(value.final_answer || value.finalAnswer, 16)
  const finalAnswer = ['left', 'right', 'skip'].includes(
    rawFinalAnswer.toLowerCase()
  )
    ? rawFinalAnswer.toLowerCase()
    : null
  const next = {
    generated_at: trimText(value.generated_at || value.generatedAt, 64) || null,
    runtime_backend:
      trimText(value.runtime_backend || value.runtimeBackend, 64) || null,
    runtime_type: trimText(value.runtime_type || value.runtimeType, 64) || null,
    model: trimText(value.model, 256) || null,
    vision_model:
      trimText(value.vision_model || value.visionModel, 256) || null,
    final_answer: finalAnswer,
    why_answer: trimText(value.why_answer || value.whyAnswer, 900),
    confidence: normalizeConfidence(value.confidence),
    text_required: normalizeBool(value.text_required ?? value.textRequired),
    sequence_markers_present: normalizeBool(
      value.sequence_markers_present ?? value.sequenceMarkersPresent
    ),
    report_required: normalizeBool(
      value.report_required ?? value.reportRequired
    ),
    report_reason: trimText(value.report_reason || value.reportReason, 400),
    option_a_summary: trimText(
      value.option_a_summary || value.optionASummary,
      400
    ),
    option_b_summary: trimText(
      value.option_b_summary || value.optionBSummary,
      400
    ),
    rating: ['good', 'bad', 'wrong'].includes(rating) ? rating : '',
  }

  return Object.values(next).some((item) => item !== null && item !== '')
    ? next
    : null
}

function normalizeAnnotation(taskRow, annotationRow) {
  const frameCaptions = normalizeCaptions(annotationRow.frame_captions)

  return {
    task_id: taskRow.task_id,
    sample_id: taskRow.sample_id || taskRow.task_id,
    flip_hash: taskRow.flip_hash || null,
    epoch: taskRow.epoch ?? null,
    annotator: trimText(annotationRow.annotator, 256) || null,
    frame_captions: frameCaptions,
    option_a_summary: trimText(annotationRow.option_a_summary),
    option_b_summary: trimText(annotationRow.option_b_summary),
    ai_annotation: normalizeAiAnnotation(
      annotationRow.ai_annotation || annotationRow.aiAnnotation
    ),
    ai_annotation_feedback: trimText(
      annotationRow.ai_annotation_feedback ||
        annotationRow.aiAnnotationFeedback,
      600
    ),
    panel_references: normalizePanelReferences(
      annotationRow.panel_references || annotationRow.panelReferences
    ),
    text_required: normalizeBool(annotationRow.text_required),
    sequence_markers_present: normalizeBool(
      annotationRow.sequence_markers_present
    ),
    report_required: normalizeBool(annotationRow.report_required),
    report_reason: trimText(annotationRow.report_reason),
    final_answer: validateFinalAnswer(annotationRow.final_answer),
    why_answer: trimText(annotationRow.why_answer),
    confidence: normalizeConfidence(annotationRow.confidence),
    consensus_answer: taskRow.final_answer || null,
    consensus_strength: taskRow.consensus_strength || null,
    training_weight:
      Number.isFinite(Number(taskRow.training_weight)) &&
      Number(taskRow.training_weight) > 0
        ? Number(taskRow.training_weight)
        : null,
    ranking_source: taskRow.ranking_source || null,
    left_order: Array.isArray(taskRow.left_order) ? taskRow.left_order : [],
    right_order: Array.isArray(taskRow.right_order) ? taskRow.right_order : [],
    words:
      taskRow.words &&
      typeof taskRow.words === 'object' &&
      !Array.isArray(taskRow.words)
        ? taskRow.words
        : {},
    selected_order: taskRow.selected_order || null,
  }
}

async function importHumanTeacherAnnotations({
  taskManifestPath,
  annotationsJsonlPath,
  outputJsonlPath,
  summaryPath,
} = {}) {
  const resolvedTaskManifestPath = path.resolve(
    String(taskManifestPath || '').trim()
  )
  const resolvedAnnotationsPath = path.resolve(
    String(annotationsJsonlPath || '').trim()
  )
  const resolvedOutputPath = path.resolve(String(outputJsonlPath || '').trim())
  const resolvedSummaryPath = summaryPath
    ? path.resolve(String(summaryPath || '').trim())
    : null

  if (
    !resolvedTaskManifestPath ||
    !resolvedAnnotationsPath ||
    !resolvedOutputPath
  ) {
    throw new Error(
      'taskManifestPath, annotationsJsonlPath, and outputJsonlPath are required'
    )
  }

  const taskRows = await loadJsonl(resolvedTaskManifestPath)
  const annotationRows = await loadJsonl(resolvedAnnotationsPath)
  const taskById = new Map(
    taskRows
      .map((row) => [String(row && row.task_id ? row.task_id : '').trim(), row])
      .filter(([taskId]) => taskId)
  )

  const normalizedRows = []
  const seenTaskIds = new Set()
  let unmatchedAnnotations = 0
  let invalidAnnotations = 0

  annotationRows.forEach((annotationRow) => {
    const taskId = String(
      annotationRow && annotationRow.task_id ? annotationRow.task_id : ''
    ).trim()

    if (!taskId || !taskById.has(taskId)) {
      unmatchedAnnotations += 1
      return
    }

    try {
      const normalized = normalizeAnnotation(
        taskById.get(taskId),
        annotationRow
      )
      normalizedRows.push(normalized)
      seenTaskIds.add(taskId)
    } catch {
      invalidAnnotations += 1
    }
  })

  const summary = {
    taskManifest: resolvedTaskManifestPath,
    annotationsJsonl: resolvedAnnotationsPath,
    outputJsonl: resolvedOutputPath,
    summaryPath: resolvedSummaryPath,
    taskRows: taskRows.length,
    annotationRows: annotationRows.length,
    normalizedRows: normalizedRows.length,
    missingAnnotations: Math.max(taskRows.length - seenTaskIds.size, 0),
    unmatchedAnnotations,
    invalidAnnotations,
  }

  await fs.ensureDir(path.dirname(resolvedOutputPath))
  await fs.writeFile(
    resolvedOutputPath,
    `${normalizedRows.map((row) => JSON.stringify(row)).join('\n')}\n`,
    'utf8'
  )

  if (resolvedSummaryPath) {
    await fs.ensureDir(path.dirname(resolvedSummaryPath))
    await fs.writeJson(resolvedSummaryPath, summary, {spaces: 2})
  }

  return {
    ...summary,
    rows: normalizedRows,
  }
}

module.exports = {
  importHumanTeacherAnnotations,
}
