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
  if (!Array.isArray(value)) {
    return []
  }

  return value.slice(0, 4).map((item) => trimText(item, 400))
}

function normalizeAiAnnotationRating(value) {
  const next = String(value || '')
    .trim()
    .toLowerCase()

  return ['good', 'bad', 'wrong'].includes(next) ? next : ''
}

function hasAiAnnotation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  return Boolean(
    value.generated_at ||
      value.runtime_backend ||
      value.runtime_type ||
      value.model ||
      value.vision_model ||
      value.final_answer ||
      value.why_answer ||
      value.option_a_summary ||
      value.option_b_summary ||
      value.rating ||
      value.report_reason ||
      value.text_required !== null ||
      value.sequence_markers_present !== null ||
      value.report_required !== null ||
      value.confidence !== null
  )
}

function normalizeAiAnnotation(value) {
  const source =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const finalAnswer = trimText(
    source.final_answer ?? source.finalAnswer,
    16
  ).toLowerCase()
  const next = {
    generated_at: trimText(source.generated_at ?? source.generatedAt, 64),
    runtime_backend: trimText(
      source.runtime_backend ?? source.runtimeBackend,
      64
    ),
    runtime_type: trimText(source.runtime_type ?? source.runtimeType, 64),
    model: trimText(source.model, 256),
    vision_model: trimText(source.vision_model ?? source.visionModel, 256),
    final_answer: VALID_FINAL_ANSWERS.has(finalAnswer) ? finalAnswer : '',
    why_answer: trimText(source.why_answer ?? source.whyAnswer, 900),
    confidence: normalizeConfidence(source.confidence),
    text_required: normalizeBool(source.text_required ?? source.textRequired),
    sequence_markers_present: normalizeBool(
      source.sequence_markers_present ?? source.sequenceMarkersPresent
    ),
    report_required: normalizeBool(
      source.report_required ?? source.reportRequired
    ),
    report_reason: trimText(source.report_reason ?? source.reportReason, 400),
    option_a_summary: trimText(
      source.option_a_summary ?? source.optionASummary,
      400
    ),
    option_b_summary: trimText(
      source.option_b_summary ?? source.optionBSummary,
      400
    ),
    rating: normalizeAiAnnotationRating(source.rating),
  }

  return hasAiAnnotation(next) ? next : null
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

function normalizeAnnotation(taskRow, annotationRow) {
  const frameCaptions = normalizeCaptions(annotationRow.frame_captions)

  if (frameCaptions.length !== 4) {
    throw new Error('frame_captions must contain 4 entries')
  }

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
